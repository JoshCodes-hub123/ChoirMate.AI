import { ScoreAnalysis, MusicNote, VocalPart } from '../types/music';

const KEY_TO_FIFTHS: Record<string, number> = {
  'C Major': 0,
  'A Minor': 0,
  'G Major': 1,
  'E Minor': 1,
  'D Major': 2,
  'B Minor': 2,
  'A Major': 3,
  'F# Minor': 3,
  'E Major': 4,
  'C# Minor': 4,
  'B Major': 5,
  'G# Minor': 5,
  'F# Major': 6,
  'D# Minor': 6,
  'F Major': -1,
  'D Minor': -1,
  'Bb Major': -2,
  'B♭ Major': -2,
  'G Minor': -2,
  'Eb Major': -3,
  'E♭ Major': -3,
  'C Minor': -3,
  'Ab Major': -4,
  'A♭ Major': -4,
  'F Minor': -4,
};

function parsePitchElements(pitch: string): { step: string; alter: number; octave: number } {
  const match = pitch.match(/^([A-G])([#b♯♭]?)(\d)$/);
  if (!match) {
    return { step: 'C', alter: 0, octave: 4 };
  }
  const [, step, acc, octStr] = match;
  const alter = acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0;
  return { step, alter, octave: parseInt(octStr, 10) };
}

function durationToMusicXml(note: MusicNote): { type: string; divisions: number; dot: boolean } {
  const kind = String(note.audioType || note.duration || 'quarter');
  const numDur = typeof note.duration === 'number' ? note.duration : 1;

  if (kind === 'whole' || numDur >= 4) return { type: 'whole', divisions: 16, dot: false };
  if (kind === 'dotted-half' || Math.abs(numDur - 3) < 0.1) return { type: 'half', divisions: 12, dot: true };
  if (kind === 'half' || Math.abs(numDur - 2) < 0.1) return { type: 'half', divisions: 8, dot: false };
  if (kind === 'dotted-quarter' || Math.abs(numDur - 1.5) < 0.1) return { type: 'quarter', divisions: 6, dot: true };
  if (kind === 'dotted-eighth' || Math.abs(numDur - 0.75) < 0.05) return { type: 'eighth', divisions: 3, dot: true };
  if (kind === 'eighth' || Math.abs(numDur - 0.5) < 0.05) return { type: 'eighth', divisions: 2, dot: false };
  if (kind === 'sixteenth' || numDur <= 0.25) return { type: '16th', divisions: 1, dot: false };
  return { type: 'quarter', divisions: 4, dot: false };
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderPartMeasuresXml(
  notes: MusicNote[],
  fifths: number,
  mode: string,
  beats: number,
  beatType: number,
  clef: 'treble' | 'bass'
): string {
  const measuresMap = new Map<number, MusicNote[]>();
  notes.forEach((n) => {
    const m = n.measure || 1;
    if (!measuresMap.has(m)) measuresMap.set(m, []);
    measuresMap.get(m)!.push(n);
  });

  const sortedMeasureNums = Array.from(measuresMap.keys()).sort((a, b) => a - b);
  if (sortedMeasureNums.length === 0) {
    sortedMeasureNums.push(1);
    measuresMap.set(1, []);
  }

  const clefSign = clef === 'bass' ? 'F' : 'G';
  const clefLine = clef === 'bass' ? '4' : '2';

  let measuresXml = '';
  sortedMeasureNums.forEach((mNum, idx) => {
    const mNotes = measuresMap.get(mNum) || [];
    measuresXml += `    <measure number="${mNum}">\n`;

    if (idx === 0) {
      measuresXml += `      <attributes>
        <divisions>4</divisions>
        <key>
          <fifths>${fifths}</fifths>
          <mode>${mode}</mode>
        </key>
        <time>
          <beats>${beats}</beats>
          <beat-type>${beatType}</beat-type>
        </time>
        <clef>
          <sign>${clefSign}</sign>
          <line>${clefLine}</line>
        </clef>
      </attributes>\n`;
    }

    mNotes.forEach((note) => {
      const { type, divisions, dot } = durationToMusicXml(note);
      const isRest = Boolean(note.isRest || note.pitch === 'REST');

      measuresXml += `      <note>\n`;
      if (isRest) {
        measuresXml += `        <rest/>\n`;
      } else {
        const { step, alter, octave } = parsePitchElements(note.pitch);
        measuresXml += `        <pitch>
          <step>${step}</step>${alter !== 0 ? `\n          <alter>${alter}</alter>` : ''}
          <octave>${octave}</octave>
        </pitch>\n`;
      }

      measuresXml += `        <duration>${divisions}</duration>\n`;
      if (note.tie === 'start' || note.tie === 'continue') {
        measuresXml += `        <tie type="start"/>\n`;
      }
      if (note.tie === 'stop' || note.tie === 'continue') {
        measuresXml += `        <tie type="stop"/>\n`;
      }
      measuresXml += `        <type>${type}</type>\n`;
      if (dot) {
        measuresXml += `        <dot/>\n`;
      }

      const lyricText = note.lyric || note.solfa;
      if (lyricText && !isRest) {
        measuresXml += `        <lyric number="1">
          <syllabic>single</syllabic>
          <text>${escapeXml(lyricText)}</text>
        </lyric>\n`;
      }
      measuresXml += `      </note>\n`;
    });

    measuresXml += `    </measure>\n`;
  });

  return measuresXml;
}

export function generateMusicXml(score: ScoreAnalysis): string {
  if (score.rawMusicXml && score.rawMusicXml.trim().startsWith('<?xml')) {
    return score.rawMusicXml;
  }

  const keyStr = score.keySignature?.key || 'C Major';
  const fifths =
    score.keySignature?.fifths ??
    (score.keySignature?.sharps
      ? score.keySignature.sharps
      : score.keySignature?.flats
      ? -score.keySignature.flats
      : KEY_TO_FIFTHS[keyStr] ?? 0);
  const mode = score.keySignature?.tonality || (keyStr.toLowerCase().includes('minor') ? 'minor' : 'major');
  const beats = score.timeSignature?.numerator || 4;
  const beatType = score.timeSignature?.denominator || 4;

  const parts: VocalPart[] =
    score.parts && score.parts.length > 0
      ? score.parts
      : [
          {
            id: 'P1',
            name: 'Choir Part 1',
            shortName: 'P1',
            clef: score.clef || 'treble',
            staffIndex: 1,
            notes: score.notes,
            measures: score.measures || [],
          },
        ];

  const partListXml = parts
    .map(
      (part) => `    <score-part id="${escapeXml(part.id || part.partId || 'P1')}">
      <part-name>${escapeXml(part.name)}</part-name>
    </score-part>`
    )
    .join('\n');

  const partsBodyXml = parts
    .map((part) => {
      const pid = part.id || part.partId || 'P1';
      const measuresXml = renderPartMeasuresXml(
        part.notes,
        fifths,
        mode,
        beats,
        beatType,
        part.clef || 'treble'
      );
      return `  <part id="${escapeXml(pid)}">\n${measuresXml}  </part>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC
    "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
    "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${escapeXml(score.title)}</work-title>
  </work>
  <identification>
    <creator type="composer">${escapeXml(score.composer || 'ChoirMate AI')}</creator>
    <encoding>
      <software>ChoirMate AI Full-Score Solfa &amp; MusicXML Engine</software>
    </encoding>
  </identification>
  <part-list>
${partListXml}
  </part-list>
${partsBodyXml}
</score-partwise>`;
}

export function downloadMusicXml(score: ScoreAnalysis) {
  const xmlContent = generateMusicXml(score);
  const blob = new Blob([xmlContent], { type: 'application/vnd.recordare.musicxml+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = score.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'choirmate-score';
  a.href = url;
  a.download = `${safeName}.musicxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
