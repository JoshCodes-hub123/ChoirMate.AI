import { MusicNote } from '../types/music';
import { getApiUrl } from './apiConfig';

export type InstrumentVoice = 'choir' | 'piano' | 'strings';
export type AudioExportFormat = 'mp3' | 'wav';

export interface PlaybackOptions {
  voice?: InstrumentVoice;
  metronome?: boolean;
  loop?: boolean;
  startIndex?: number;
  onProgress?: (currentIndex: number, totalEvents: number) => void;
}

export interface ExportAudioParams {
  notes: MusicNote[];
  title: string;
  partName?: string;
  scopeLabel?: string;
  tempo: number;
  voice?: InstrumentVoice;
  format: AudioExportFormat;
  metronome?: boolean;
}

export interface ExportAudioResult {
  fileName: string;
  format: AudioExportFormat;
  mimeType: string;
  durationSeconds: number;
  byteLength: number;
}

function sanitizeSlug(text: string, fallback = 'score'): string {
  const cleaned = (text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 48) || fallback;
}

export function buildPracticeAudioFileName(
  title: string,
  partName: string | undefined,
  scopeLabel: string | undefined,
  tempo: number,
  format: AudioExportFormat
): string {
  const songSlug = sanitizeSlug(title, 'choirmate-score');
  const partSlug = sanitizeSlug(partName || 'full-choir', 'part');
  const scopeSlug = sanitizeSlug(scopeLabel || 'full-song', 'full-song');
  return `${songSlug}_${partSlug}_${scopeSlug}_${Math.round(tempo || 88)}bpm.${format}`;
}

export function pitchToFrequency(pitch: string): number {
  if (!pitch || pitch.toUpperCase() === 'REST') return 0;
  const noteMap: Record<string, number> = {
    C: 0,
    'C#': 1,
    Db: 1,
    D: 2,
    'D#': 3,
    Eb: 3,
    E: 4,
    F: 5,
    'F#': 6,
    Gb: 6,
    G: 7,
    'G#': 8,
    Ab: 8,
    A: 9,
    'A#': 10,
    Bb: 10,
    B: 11,
  };
  const match = pitch.trim().match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 440;
  const [, noteName, octaveStr] = match;
  const semitone = noteMap[noteName] ?? 9;
  const octave = parseInt(octaveStr, 10);
  const midi = (octave + 1) * 12 + semitone;
  return Number((440 * Math.pow(2, (midi - 69) / 12)).toFixed(2));
}

export type PlayableNoteEvent = Partial<MusicNote> & {
  frequency: number;
  duration: number | string;
};

export class ChoirAudioEngine {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private isPaused = false;
  private loopEnabled = false;
  private currentNotes: PlayableNoteEvent[] = [];

  private currentTempo = 88;
  private currentIndex = 0;
  private currentVoice: InstrumentVoice = 'choir';
  private currentMetronome = false;
  private onNoteChangeCb: ((index: number | null) => void) | null = null;
  private onCompleteCb: (() => void) | null = null;
  private onProgressCb: ((currentIndex: number, totalEvents: number) => void) | null = null;
  private timeoutIds: number[] = [];

  private initContext() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public getDurationSeconds(
    duration: number | string,
    tempo: number,
    audioType?: string
  ): number {
    const secondsPerBeat = 60 / Math.max(36, Math.min(220, tempo || 88));
    if (typeof duration === 'number' && duration > 0) {
      return duration * secondsPerBeat;
    }
    const typeStr = (audioType || String(duration)).toLowerCase();
    switch (typeStr) {
      case 'whole':
        return secondsPerBeat * 4;
      case 'dotted-half':
        return secondsPerBeat * 3;
      case 'half':
        return secondsPerBeat * 2;
      case 'dotted-quarter':
        return secondsPerBeat * 1.5;
      case 'quarter':
        return secondsPerBeat * 1;
      case 'dotted-eighth':
        return secondsPerBeat * 0.75;
      case 'eighth':
        return secondsPerBeat * 0.5;
      case 'sixteenth':
        return secondsPerBeat * 0.25;
      default:
        return secondsPerBeat;
    }
  }

  public getTotalDurationSeconds(notes: MusicNote[], tempo: number): number {
    return notes.reduce(
      (sum, n) => sum + this.getDurationSeconds(n.duration, tempo, n.audioType),
      0
    );
  }

  public playMetronomeClick(isDownbeat = false) {
    this.initContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isDownbeat ? 1150 : 820, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(isDownbeat ? 0.16 : 0.09, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playNote(
    frequency: number,
    durationSec: number,
    voice: InstrumentVoice = 'choir',
    chordFrequencies?: number[]
  ) {
    if (!frequency || frequency <= 0) return;
    this.initContext();
    if (!this.ctx) return;

    const allFreqs =
      chordFrequencies && chordFrequencies.length > 1 ? chordFrequencies : [frequency];

    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(
      voice === 'piano' ? 2800 : voice === 'strings' ? 2100 : 1750,
      now
    );

    const masterGain = this.ctx.createGain();
    const polyphonyScale = 1 / Math.sqrt(allFreqs.length);
    const peakGain = (voice === 'piano' ? 0.25 : 0.21) * polyphonyScale;
    const attackTime = voice === 'piano' ? 0.015 : 0.055;

    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(peakGain, now + attackTime);
    masterGain.gain.setValueAtTime(
      peakGain * 0.85,
      now + Math.max(attackTime + 0.01, durationSec - 0.075)
    );
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    filter.connect(masterGain);
    masterGain.connect(this.ctx.destination);

    for (const freq of allFreqs) {
      if (freq <= 0) continue;
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      if (voice === 'piano') {
        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc2.detune.setValueAtTime(2, now);
      } else if (voice === 'strings') {
        osc1.type = 'sawtooth';
        osc2.type = 'triangle';
        osc2.detune.setValueAtTime(6, now);
      } else {
        osc1.type = 'triangle';
        osc2.type = 'sawtooth';
        osc2.detune.setValueAtTime(4, now);
      }

      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq, now);

      const subGain2 = this.ctx.createGain();
      subGain2.gain.setValueAtTime(voice === 'piano' ? 0.4 : 0.25, now);

      osc1.connect(filter);
      osc2.connect(subGain2);
      subGain2.connect(filter);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durationSec);
      osc2.stop(now + durationSec);
    }
  }

  public setLoop(enabled: boolean) {
    this.loopEnabled = enabled;
  }

  public playMelodySequence(
    notes: PlayableNoteEvent[],
    tempo: number,
    onNoteChange: (index: number | null) => void,
    onComplete: () => void,
    options?: PlaybackOptions
  ) {
    this.clearScheduledTimeouts();
    this.initContext();

    this.currentNotes = notes;

    this.currentTempo = tempo || 88;
    this.currentVoice = options?.voice || 'choir';
    this.currentMetronome = Boolean(options?.metronome);
    this.loopEnabled = Boolean(options?.loop ?? this.loopEnabled);
    this.onNoteChangeCb = onNoteChange;
    this.onCompleteCb = onComplete;
    this.onProgressCb = options?.onProgress || null;
    this.currentIndex = Math.max(0, Math.min(options?.startIndex || 0, Math.max(0, notes.length - 1)));
    this.isPlaying = true;
    this.isPaused = false;

    this.scheduleFromIndex(this.currentIndex);
  }

  private scheduleFromIndex(startIdx: number) {
    this.clearScheduledTimeouts();
    const notes = this.currentNotes;
    if (!notes || notes.length === 0) {
      this.isPlaying = false;
      this.onCompleteCb?.();
      return;
    }

    let accumulatedMs = 0;

    for (let idx = startIdx; idx < notes.length; idx++) {
      const note = notes[idx];
      const durSec = this.getDurationSeconds(note.duration, this.currentTempo, note.audioType);

      let tiedExtraSec = 0;
      if (note.tie === 'start' || note.tie === 'continue') {
        let lookahead = idx + 1;
        while (
          lookahead < notes.length &&
          notes[lookahead].pitch === note.pitch &&
          !notes[lookahead].isRest
        ) {
          tiedExtraSec += this.getDurationSeconds(
            notes[lookahead].duration,
            this.currentTempo,
            notes[lookahead].audioType
          );
          if (notes[lookahead].tie === 'stop' || !notes[lookahead].tie) {
            break;
          }
          lookahead++;
        }
      }

      const isTiedContinuation =
        idx > 0 &&
        !note.isRest &&
        notes[idx - 1].pitch === note.pitch &&
        (notes[idx - 1].tie === 'start' || notes[idx - 1].tie === 'continue');

      const timeoutId = window.setTimeout(() => {
        if (!this.isPlaying || this.isPaused) return;
        this.currentIndex = idx;
        this.onNoteChangeCb?.(idx);
        this.onProgressCb?.(idx, notes.length);

        if (this.currentMetronome) {
          this.playMetronomeClick(note.beat === 1);
        }

        const isRestEvent = Boolean(
          note.isRest || note.pitch === 'REST' || note.frequency <= 0
        );
        if (!isRestEvent && !isTiedContinuation) {
          this.playNote(
            note.frequency,
            Math.max(0.08, durSec + tiedExtraSec - 0.025),
            this.currentVoice,
            note.chordFrequencies
          );
        }
      }, accumulatedMs);

      this.timeoutIds.push(timeoutId);
      accumulatedMs += durSec * 1000;
    }

    const endTimeoutId = window.setTimeout(() => {
      if (!this.isPlaying || this.isPaused) return;
      if (this.loopEnabled && this.currentNotes.length > 0) {
        this.currentIndex = 0;
        this.scheduleFromIndex(0);
      } else {
        this.isPlaying = false;
        this.isPaused = false;
        this.currentIndex = 0;
        this.onNoteChangeCb?.(null);
        this.onCompleteCb?.();
      }
    }, accumulatedMs);

    this.timeoutIds.push(endTimeoutId);
  }

  public pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    this.clearScheduledTimeouts();
  }

  public resume() {
    if (!this.isPaused || this.currentNotes.length === 0) return;
    this.isPaused = false;
    this.isPlaying = true;
    this.scheduleFromIndex(this.currentIndex);
  }

  public restart() {
    if (this.currentNotes.length === 0) return;
    this.clearScheduledTimeouts();
    this.currentIndex = 0;
    this.isPaused = false;
    this.isPlaying = true;
    this.scheduleFromIndex(0);
  }

  private clearScheduledTimeouts() {
    this.timeoutIds.forEach((id) => clearTimeout(id));
    this.timeoutIds = [];
  }

  public stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentIndex = 0;
    this.clearScheduledTimeouts();
  }

  public stopPlayback() {
    this.stop();
  }


  public getState() {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      loopEnabled: this.loopEnabled,
      currentIndex: this.currentIndex,
    };
  }
}

export const audioEngine = new ChoirAudioEngine();

/**
 * Fallback client-side 16-bit 44.1kHz PCM WAV synthesizer if server is unreachable.
 */
function synthesizeClientWavBlob(
  notes: MusicNote[],
  tempo: number,
  voice: InstrumentVoice
): { blob: Blob; durationSeconds: number } {
  const sampleRate = 44100;
  const secPerBeat = 60 / Math.max(36, Math.min(220, tempo || 88));
  const buffers: Float32Array[] = [];

  for (const n of notes) {
    const beats = typeof n.duration === 'number' && n.duration > 0 ? n.duration : 1;
    const durSec = Math.max(0.06, beats * secPerBeat);
    const numSamples = Math.max(1, Math.round(durSec * sampleRate));
    const seg = new Float32Array(numSamples);
    const isRest = Boolean(n.isRest || n.pitch === 'REST' || (n.frequency || 0) <= 0);

    if (!isRest) {
      const freq = n.frequency;
      const soundSamples = Math.max(1, Math.round(Math.max(0.04, durSec - 0.018) * sampleRate));
      for (let i = 0; i < soundSamples; i++) {
        const t = i / sampleRate;
        const att = Math.min(1, t / 0.04);
        const rel = Math.min(1, (soundSamples - i) / (0.05 * sampleRate));
        const env = att * rel;
        const h1 = Math.sin(2 * Math.PI * freq * t);
        const h2 = (voice === 'piano' ? 0.35 : 0.45) * Math.sin(4 * Math.PI * freq * t);
        const h3 = 0.2 * Math.sin(6 * Math.PI * freq * t);
        seg[i] = (h1 + h2 + h3) * env * 0.25;
      }
    }
    buffers.push(seg);
  }

  const tailSamples = Math.round(0.2 * sampleRate);
  const totalSamples = buffers.reduce((s, b) => s + b.length, 0) + tailSamples;
  const pcm16 = new Int16Array(totalSamples);
  let offset = 0;
  for (const b of buffers) {
    for (let i = 0; i < b.length; i++) {
      const clamped = Math.max(-1, Math.min(1, b[i]));
      pcm16[offset++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
  }

  const wavBuffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(wavBuffer);
  const writeStr = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm16.length * 2, true);

  const pcmBytes = new Uint8Array(wavBuffer, 44);
  pcmBytes.set(new Uint8Array(pcm16.buffer));

  return {
    blob: new Blob([wavBuffer], { type: 'audio/wav' }),
    durationSeconds: Number((totalSamples / sampleRate).toFixed(2)),
  };
}

function triggerBrowserBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Generates and downloads a practice audio file (MP3 or WAV) for desktop and Android mobile browsers.
 * Uses the server's FFmpeg/NumPy synthesis pipeline so MP3 downloads are genuine MPEG Layer-3 audio
 * and WAV downloads are 44.1kHz 16-bit PCM WAV, matching the latest corrected notes and rhythm.
 */
export async function exportPracticeAudioFile(
  params: ExportAudioParams
): Promise<ExportAudioResult> {
  if (!params.notes || params.notes.length === 0) {
    throw new Error('No musical events are available in the selected section to export.');
  }

  try {
    const response = await fetch(getApiUrl('/api/export-audio'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: params.notes,
        title: params.title || 'Practice Score',
        partName: params.partName || 'Vocal Part',
        scopeLabel: params.scopeLabel || 'Full Song',
        tempo: params.tempo || 88,
        voice: params.voice || 'choir',
        format: params.format,
        metronome: Boolean(params.metronome),
      }),
    });

    const json = await response.json();
    if (!response.ok || !json.success || !json.audioBase64) {
      throw new Error(json.error || 'Could not generate downloadable practice audio.');
    }

    const binaryStr = window.atob(json.audioBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const mimeType =
      json.mimeType || (params.format === 'mp3' ? 'audio/mpeg' : 'audio/wav');
    const fileName =
      json.fileName ||
      buildPracticeAudioFileName(
        params.title,
        params.partName,
        params.scopeLabel,
        params.tempo,
        params.format
      );

    const blob = new Blob([bytes], { type: mimeType });
    triggerBrowserBlobDownload(blob, fileName);

    return {
      fileName,
      format: params.format,
      mimeType,
      durationSeconds: json.durationSeconds || 0,
      byteLength: bytes.length,
    };
  } catch (err) {
    if (params.format === 'wav') {
      const { blob, durationSeconds } = synthesizeClientWavBlob(
        params.notes,
        params.tempo || 88,
        params.voice || 'choir'
      );
      const fileName = buildPracticeAudioFileName(
        params.title,
        params.partName,
        params.scopeLabel,
        params.tempo,
        'wav'
      );
      triggerBrowserBlobDownload(blob, fileName);
      return {
        fileName,
        format: 'wav',
        mimeType: 'audio/wav',
        durationSeconds,
        byteLength: blob.size,
      };
    }
    throw err;
  }
}
