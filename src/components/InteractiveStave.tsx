import React from 'react';
import { MusicNote } from '../types/music';

interface InteractiveStaveProps {
  notes: MusicNote[];
  activeNoteIndex: number | null;
  onNoteClick?: (note: MusicNote, index: number) => void;
  showSolfa?: boolean;
  showPitch?: boolean;
  keySignature?: string;
  timeSignature?: string;
  clef?: 'treble' | 'bass';
}

function getPitchY(pitch: string, clef: 'treble' | 'bass' = 'treble'): number {
  if (!pitch || pitch === 'REST') return 40;
  const match = pitch.match(/^([A-G])([#b♯♭]?)(\d)$/);
  if (!match) return 40;

  const [, step, , octStr] = match;
  const octave = parseInt(octStr, 10);

  const stepValues: Record<string, number> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
  };

  const stepIndex = octave * 7 + (stepValues[step] ?? 0);

  if (clef === 'bass') {
    // Bass clef: bottom line (y=60) is G2 (2*7+4 = 18), top line (y=20) is A3 (3*7+5 = 26)
    const g2Index = 2 * 7 + 4; // 18
    const diffFromG2 = stepIndex - g2Index;
    return 60 - diffFromG2 * 5;
  }

  // Treble clef: bottom line (y=60) is E4 (4*7+2 = 30), top line (y=20) is F5 (5*7+3 = 38)
  // Middle C (C4 = 28) is at y = 70 (one ledger line below E4=60)
  const c4Index = 4 * 7 + 0; // 28
  const diffFromC4 = stepIndex - c4Index;
  return 70 - diffFromC4 * 5;
}

function getNoteAudioType(note: MusicNote): string {
  if (note.audioType) return note.audioType;
  if (typeof note.duration === 'string') return note.duration;
  const d = Number(note.duration || 1);
  if (d >= 3.5) return 'whole';
  if (Math.abs(d - 3) < 0.15) return 'dotted-half';
  if (Math.abs(d - 2) < 0.15) return 'half';
  if (Math.abs(d - 1.5) < 0.15) return 'dotted-quarter';
  if (Math.abs(d - 0.75) < 0.1) return 'dotted-eighth';
  if (Math.abs(d - 0.5) < 0.1) return 'eighth';
  if (d <= 0.3) return 'sixteenth';
  return 'quarter';
}

export const InteractiveStave: React.FC<InteractiveStaveProps> = ({
  notes,
  activeNoteIndex,
  onNoteClick,
  showSolfa = true,
  showPitch = true,
  timeSignature = '4/4',
  clef = 'treble',
}) => {
  const staveLeft = 75;
  const noteSpacing = 66;
  const totalWidth = Math.max(760, staveLeft + notes.length * noteSpacing + 65);
  const staveHeight = 165;
  // Staff lines are at y = 20, 30, 40, 50, 60 so that Treble E4=60..F5=20 and Bass G2=60..A3=20 match getPitchY()
  const staveTop = 20;

  const [beatsTop, beatsBottom] = (timeSignature || '4/4').split('/');

  return (
    <div className="w-full overflow-x-auto pb-2 custom-scrollbar">
      <svg
        width={totalWidth}
        height={staveHeight}
        viewBox={`0 0 ${totalWidth} ${staveHeight}`}
        className="min-w-full select-none"
      >
        {/* 5 Stave Lines at y = 20, 30, 40, 50, 60 */}
        {[0, 1, 2, 3, 4].map((lineIdx) => {
          const y = staveTop + lineIdx * 10;
          return (
            <line
              key={lineIdx}
              x1={16}
              y1={y}
              x2={totalWidth - 20}
              y2={y}
              stroke="#C5BCAD"
              strokeWidth="1.25"
            />
          );
        })}

        {/* Initial Barline */}
        <line
          x1={16}
          y1={staveTop}
          x2={16}
          y2={staveTop + 40}
          stroke="#4A443C"
          strokeWidth="2"
        />

        {/* Clef Symbol */}
        {clef === 'bass' ? (
          <g transform="translate(22, 18)">
            <circle cx="8" cy="12" r="3.5" fill="#2A2622" />
            <path
              d="M8 12 C8 4, 22 4, 22 15 C22 25, 10 34, 4 38"
              stroke="#2A2622"
              strokeWidth="2.8"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="26" cy="9" r="2" fill="#2A2622" />
            <circle cx="26" cy="17" r="2" fill="#2A2622" />
          </g>
        ) : (
          <text
            x={21}
            y={staveTop + 36}
            fontSize="44"
            fontFamily="serif"
            fill="#2A2622"
          >
            𝄞
          </text>
        )}

        {/* Time Signature */}
        <g transform={`translate(52, ${staveTop + 16})`} className="font-serif font-bold fill-[#2A2622]">
          <text x="0" y="0" fontSize="18" textAnchor="middle">
            {beatsTop || '4'}
          </text>
          <text x="0" y="19" fontSize="18" textAnchor="middle">
            {beatsBottom || '4'}
          </text>
        </g>

        {/* Notes, Rests & Measure Barlines */}
        {notes.map((note, idx) => {
          const x = staveLeft + idx * noteSpacing + 24;
          const isRest = Boolean(note.isRest || note.pitch === 'REST');
          const effectiveClef = note.clef || clef;
          const y = isRest ? staveTop + 20 : getPitchY(note.pitch, effectiveClef);
          const isActive = activeNoteIndex === idx;
          const audioKind = getNoteAudioType(note);
          const isHollow =
            audioKind === 'whole' ||
            audioKind === 'half' ||
            audioKind === 'dotted-half';
          const isDotted = audioKind.startsWith('dotted-') || (note.dots ?? 0) > 0;
          const hasStem = !isRest && audioKind !== 'whole';
          const stemUp = y >= staveTop + 20;

          const showBarline =
            idx > 0 && note.measure !== notes[idx - 1].measure;

          // Ledger lines above y=20 (y <= 10) or below y=60 (y >= 70)
          const ledgerYs: number[] = [];
          if (!isRest) {
            for (let ly = 70; ly <= y; ly += 10) {
              ledgerYs.push(ly);
            }
            for (let ly = 10; ly >= y; ly -= 10) {
              ledgerYs.push(ly);
            }
          }

          const hasCurveToNext =
            idx < notes.length - 1 &&
            !isRest &&
            (note.tie === 'start' || note.tie === 'continue' || note.slur === 'start');
          const nextX = staveLeft + (idx + 1) * noteSpacing + 24;
          const nextY =
            idx < notes.length - 1
              ? getPitchY(notes[idx + 1].pitch, notes[idx + 1].clef || effectiveClef)
              : y;

          const isUncertain = note.confidence === 'low' || note.confidence === 'medium';

          const rawAcc = note.accidental;
          const parsedAcc =
            rawAcc === 'sharp' || rawAcc === '#'
              ? '#'
              : rawAcc === 'flat' || rawAcc === 'b'
              ? 'b'
              : rawAcc === 'natural' || rawAcc === '♮'
              ? '♮'
              : note.pitch.includes('#')
              ? '#'
              : note.pitch.includes('b')
              ? 'b'
              : null;

          return (
            <g
              key={`${note.measure}-${idx}`}
              onClick={() => onNoteClick && onNoteClick(note, idx)}
              className="cursor-pointer group"
            >
              {/* Measure Barline & Measure Number */}
              {showBarline && (
                <g>
                  <line
                    x1={x - noteSpacing / 2}
                    y1={staveTop}
                    x2={x - noteSpacing / 2}
                    y2={staveTop + 40}
                    stroke="#8C8274"
                    strokeWidth="1.4"
                  />
                  <text
                    x={x - noteSpacing / 2 + 4}
                    y={staveTop - 6}
                    fontSize="9"
                    className="font-mono fill-[#8C8274]"
                  >
                    m.{note.measure}
                  </text>
                </g>
              )}

              {/* Measure 1 label */}
              {idx === 0 && (
                <text
                  x={x - 12}
                  y={staveTop - 6}
                  fontSize="9"
                  className="font-mono fill-[#8C8274]"
                >
                  m.{note.measure}
                </text>
              )}

              {/* Active Highlight Column */}
              {isActive && (
                <rect
                  x={x - 22}
                  y={6}
                  width={44}
                  height={staveHeight - 12}
                  rx={10}
                  fill="#B85D19"
                  fillOpacity="0.14"
                  stroke="#B85D19"
                  strokeWidth="1.2"
                  strokeDasharray="3 2"
                />
              )}

              {/* Low-Confidence Indicator */}
              {isUncertain && !isActive && (
                <rect
                  x={x - 20}
                  y={8}
                  width={40}
                  height={staveHeight - 16}
                  rx={8}
                  fill="#D97706"
                  fillOpacity="0.08"
                />
              )}

              {/* Dynamic Marking */}
              {note.dynamic && (
                <text
                  x={x - 6}
                  y={13}
                  fontSize="11"
                  fontStyle="italic"
                  fontWeight="bold"
                  fontFamily="serif"
                  fill="#7A5230"
                >
                  {note.dynamic}
                </text>
              )}

              {/* Uncertainty Warning Badge */}
              {isUncertain && (
                <text
                  x={x + 12}
                  y={14}
                  fontSize="9"
                  fontWeight="bold"
                  fill="#B45309"
                >
                  !
                </text>
              )}

              {/* Ledger Lines */}
              {ledgerYs.map((ly) => (
                <line
                  key={ly}
                  x1={x - 12}
                  y1={ly}
                  x2={x + 12}
                  y2={ly}
                  stroke="#6A6258"
                  strokeWidth="1.5"
                />
              ))}

              {/* Rest Symbol OR Notehead + Stem */}
              {isRest ? (
                <g>
                  {audioKind.includes('whole') ? (
                    <rect
                      x={x - 7}
                      y={staveTop + 10}
                      width={14}
                      height={5}
                      fill={isActive ? '#B85D19' : '#4A443C'}
                    />
                  ) : audioKind.includes('half') ? (
                    <rect
                      x={x - 7}
                      y={staveTop + 15}
                      width={14}
                      height={5}
                      fill={isActive ? '#B85D19' : '#4A443C'}
                    />
                  ) : audioKind.includes('eighth') || audioKind.includes('sixteenth') ? (
                    <text
                      x={x}
                      y={staveTop + 26}
                      textAnchor="middle"
                      fontSize="20"
                      fontFamily="serif"
                      fill={isActive ? '#B85D19' : '#4A443C'}
                    >
                      𝄾
                    </text>
                  ) : (
                    <path
                      d={`M ${x - 3} ${staveTop + 9} L ${x + 4} ${staveTop + 17} L ${x - 3} ${staveTop + 24} L ${x + 4} ${staveTop + 31} C ${x - 2} ${staveTop + 30}, ${x - 5} ${staveTop + 34}, ${x - 1} ${staveTop + 37}`}
                      stroke={isActive ? '#B85D19' : '#4A443C'}
                      strokeWidth="2.4"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {isDotted && (
                    <circle
                      cx={x + 11}
                      cy={staveTop + 15}
                      r={2.2}
                      fill={isActive ? '#B85D19' : '#4A443C'}
                    />
                  )}
                </g>
              ) : (
                <g>
                  {parsedAcc && (
                    <text
                      x={x - 15}
                      y={y + 4}
                      fontSize="14"
                      fontWeight="bold"
                      fontFamily="serif"
                      fill={isActive ? '#B85D19' : '#2A2622'}
                    >
                      {parsedAcc === '#' ? '♯' : parsedAcc === 'b' ? '♭' : '♮'}
                    </text>
                  )}

                  {/* Primary Notehead */}
                  <ellipse
                    cx={x}
                    cy={y}
                    rx={6.8}
                    ry={4.8}
                    transform={`rotate(-18 ${x} ${y})`}
                    fill={isHollow ? '#FDFBF7' : isActive ? '#B85D19' : '#2A2622'}
                    stroke={isActive ? '#B85D19' : '#2A2622'}
                    strokeWidth="2"
                    className="transition-colors duration-150 group-hover:stroke-[#B85D19]"
                  />

                  {/* Additional Simultaneous Chord Noteheads */}
                  {note.chordPitches &&
                    note.chordPitches.map((cp, cIdx) => {
                      const cy = getPitchY(cp, effectiveClef);
                      return (
                        <ellipse
                          key={`${cp}-${cIdx}`}
                          cx={x}
                          cy={cy}
                          rx={6.2}
                          ry={4.4}
                          transform={`rotate(-18 ${x} ${cy})`}
                          fill={isHollow ? '#FDFBF7' : isActive ? '#B85D19' : '#57534E'}
                          stroke={isActive ? '#B85D19' : '#57534E'}
                          strokeWidth="1.8"
                        />
                      );
                    })}

                  {/* Dotted Rhythm Dot */}
                  {isDotted && (
                    <circle
                      cx={x + 11}
                      cy={y % 10 === 0 ? y - 3 : y}
                      r={2.3}
                      fill={isActive ? '#B85D19' : '#2A2622'}
                    />
                  )}

                  {/* Note Stem */}
                  {hasStem && (
                    <line
                      x1={stemUp ? x + 6 : x - 6}
                      y1={y}
                      x2={stemUp ? x + 6 : x - 6}
                      y2={stemUp ? y - 30 : y + 30}
                      stroke={isActive ? '#B85D19' : '#2A2622'}
                      strokeWidth="1.8"
                    />
                  )}

                  {/* Eighth / Sixteenth Flag */}
                  {(audioKind === 'eighth' ||
                    audioKind === 'dotted-eighth' ||
                    audioKind === 'sixteenth') && (
                    <path
                      d={
                        stemUp
                          ? `M ${x + 6} ${y - 30} Q ${x + 16} ${y - 23} ${x + 13} ${y - 13}`
                          : `M ${x - 6} ${y + 30} Q ${x + 4} ${y + 23} ${x + 1} ${y + 13}`
                      }
                      stroke={isActive ? '#B85D19' : '#2A2622'}
                      strokeWidth="2"
                      fill="none"
                    />
                  )}
                </g>
              )}

              {/* Tie / Slur Curve */}
              {hasCurveToNext && (
                <path
                  d={`M ${x + 6} ${y + 7} Q ${(x + nextX) / 2} ${Math.max(y, nextY) + 19} ${nextX - 6} ${nextY + 7}`}
                  stroke={note.tie ? '#B85D19' : '#6A6258'}
                  strokeWidth="1.6"
                  strokeDasharray={note.slur ? '3 2' : undefined}
                  fill="none"
                />
              )}

              {/* Tuplet Badge */}
              {note.tuplet && (
                <text
                  x={x}
                  y={stemUp ? y - 35 : y + 42}
                  textAnchor="middle"
                  fontSize="9"
                  fontWeight="bold"
                  fill="#B85D19"
                >
                  3
                </text>
              )}

              {/* Solfa Syllable Pill */}
              {showSolfa && (
                <g transform={`translate(${x}, 115)`}>
                  <rect
                    x={-19}
                    y={-12}
                    width={38}
                    height={20}
                    rx={6}
                    fill={
                      isActive
                        ? '#B85D19'
                        : isRest
                        ? '#E7E2D8'
                        : '#F3EFE6'
                    }
                    stroke={isActive ? '#B85D19' : '#DFD9CE'}
                    strokeWidth="1"
                  />
                  <text
                    x={0}
                    y={2}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill={
                      isActive
                        ? '#FFFFFF'
                        : isRest
                        ? '#78716C'
                        : '#9A4B12'
                    }
                  >
                    {isRest ? 'Rest' : note.solfa}
                  </text>
                </g>
              )}

              {/* Pitch / Lyric Subtitle */}
              {showPitch && (
                <text
                  x={x}
                  y={146}
                  textAnchor="middle"
                  fontSize="10"
                  className="font-mono"
                  fill={isActive ? '#2A2622' : '#78716C'}
                  fontWeight={isActive ? '600' : '400'}
                >
                  {isRest ? `(${audioKind})` : note.lyric ? `${note.lyric} (${note.pitch})` : note.pitch}
                </text>
              )}
            </g>
          );
        })}

        {/* Final Double Barline */}
        <line
          x1={totalWidth - 25}
          y1={staveTop}
          x2={totalWidth - 25}
          y2={staveTop + 40}
          stroke="#4A443C"
          strokeWidth="1.5"
        />
        <line
          x1={totalWidth - 20}
          y1={staveTop}
          x2={totalWidth - 20}
          y2={staveTop + 40}
          stroke="#4A443C"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
};
