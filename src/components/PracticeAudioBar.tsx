import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Square,
  Repeat,
  Download,
  Clock,
  Piano,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Volume2,
} from 'lucide-react';
import { MusicNote } from '../types/music';
import {
  audioEngine,
  InstrumentVoice,
  AudioExportFormat,
  exportPracticeAudioFile,
  buildPracticeAudioFileName,
} from '../utils/audioPlayer';

interface PracticeAudioBarProps {
  title: string;
  partName: string;
  fullPartNotes: MusicNote[];
  sectionNotes: MusicNote[];
  sectionLabel: string;
  tempo: number;
  onTempoChange: (newTempo: number) => void;
  voice: InstrumentVoice;
  onVoiceChange: (newVoice: InstrumentVoice) => void;
  metronomeOn: boolean;
  onMetronomeToggle: () => void;
  isPlaying: boolean;
  isPaused: boolean;
  loopEnabled: boolean;
  activeNoteIndex: number | null;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  extraRightActions?: React.ReactNode;
}

export const PracticeAudioBar: React.FC<PracticeAudioBarProps> = ({
  title,
  partName,
  fullPartNotes,
  sectionNotes,
  sectionLabel,
  tempo,
  onTempoChange,
  voice,
  onVoiceChange,
  metronomeOn,
  onMetronomeToggle,
  isPlaying,
  isPaused,
  loopEnabled,
  activeNoteIndex,
  onPlay,
  onPause,
  onResume,
  onRestart,
  onStop,
  onToggleLoop,
  extraRightActions,
}) => {
  const [exportScope, setExportScope] = useState<'section' | 'full'>('section');
  const [exportingFormat, setExportingFormat] = useState<AudioExportFormat | null>(null);
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const isSectionFiltered = sectionNotes.length !== fullPartNotes.length;
  const targetExportNotes =
    exportScope === 'full' || !isSectionFiltered ? fullPartNotes : sectionNotes;
  const targetScopeSlug =
    exportScope === 'full' || !isSectionFiltered ? 'full-song' : sectionLabel;

  const totalSec = Math.round(
    audioEngine.getTotalDurationSeconds(sectionNotes, tempo)
  );
  const progressPercent =
    activeNoteIndex !== null && sectionNotes.length > 0
      ? Math.min(100, Math.round(((activeNoteIndex + 1) / sectionNotes.length) * 100))
      : 0;

  const previewMp3Name = buildPracticeAudioFileName(
    title,
    partName,
    targetScopeSlug,
    tempo,
    'mp3'
  );

  const handleDownloadAudio = async (format: AudioExportFormat) => {
    if (exportingFormat) return;
    setExportingFormat(format);
    setExportStatus(null);
    try {
      const res = await exportPracticeAudioFile({
        notes: targetExportNotes,
        title,
        partName,
        scopeLabel: targetScopeSlug,
        tempo,
        voice,
        format,
        metronome: metronomeOn,
      });
      const kb = Math.max(1, Math.round(res.byteLength / 1024));
      setExportStatus({
        type: 'success',
        message: `Downloaded ${res.fileName} (${res.format.toUpperCase()} • ${res.durationSeconds}s • ${kb} KB)`,
      });
    } catch (err: unknown) {
      setExportStatus({
        type: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Could not generate practice audio download.',
      });
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
      {/* Row 1: Primary Transport Controls + Tempo + Voice + Loop */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {/* Transport Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {!isPlaying && !isPaused ? (
            <button
              type="button"
              onClick={onPlay}
              disabled={sectionNotes.length === 0}
              className="min-h-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs bg-[#B85D19] hover:bg-[#9F4E12] text-white flex items-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Play Reference ({sectionNotes.length} events • ~{totalSec}s)</span>
            </button>
          ) : isPaused ? (
            <button
              type="button"
              onClick={onResume}
              className="min-h-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs bg-[#1F7A4C] hover:bg-[#18633D] text-white flex items-center gap-2 transition-all cursor-pointer shadow-xs"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              className="min-h-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs bg-[#2A2622] hover:bg-[#142F23] text-white flex items-center gap-2 transition-all cursor-pointer shadow-xs"
            >
              <Pause className="w-4 h-4 fill-current" />
              <span>Pause</span>
            </button>
          )}

          {(isPlaying || isPaused) && (
            <>
              <button
                type="button"
                onClick={onRestart}
                className="min-h-[44px] px-3.5 py-2 rounded-xl font-semibold text-xs bg-white hover:bg-[#F3EFE6] text-[#2A2622] border border-[#DED8CC] flex items-center gap-1.5 cursor-pointer"
                title="Restart from first note of section"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#B85D19]" />
                <span>Restart</span>
              </button>
              <button
                type="button"
                onClick={onStop}
                className="min-h-[44px] px-3.5 py-2 rounded-xl font-semibold text-xs bg-white hover:bg-[#FDF2F2] text-[#991B1B] border border-[#F5C2C7] flex items-center gap-1.5 cursor-pointer"
                title="Stop playback"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            </>
          )}

          {/* Loop Section Toggle */}
          <button
            type="button"
            onClick={onToggleLoop}
            className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
              loopEnabled
                ? 'bg-[#FDF3EB] border-[#B85D19] text-[#B85D19]'
                : 'bg-[#F3EFE6] border-[#E6E0D4] text-[#6A6258] hover:text-[#2A2622]'
            }`}
            title="Loop selected practice section continuously"
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>Loop {loopEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* Metronome Toggle */}
          <button
            type="button"
            onClick={onMetronomeToggle}
            className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
              metronomeOn
                ? 'bg-[#FDF3EB] border-[#B85D19] text-[#B85D19]'
                : 'bg-[#F3EFE6] border-[#E6E0D4] text-[#6A6258] hover:text-[#2A2622]'
            }`}
            title="Include steady metronome click in playback and audio export"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Click {metronomeOn ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Voice Selector & Tempo Control */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Instrument Voice Selector */}
          <div className="flex items-center bg-[#F3EFE6] p-1 rounded-xl border border-[#E6E0D4]">
            {(['choir', 'piano', 'strings'] as InstrumentVoice[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onVoiceChange(v)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer flex items-center gap-1.5 ${
                  voice === v
                    ? 'bg-white text-[#B85D19] shadow-xs'
                    : 'text-[#6A6258] hover:text-[#2A2622]'
                }`}
              >
                {v === 'piano' && <Piano className="w-3.5 h-3.5" />}
                {v === 'choir' ? 'Choir Synth' : v}
              </button>
            ))}
          </div>

          {/* Tempo Slider with Tabular Nums */}
          <div className="flex items-center gap-2.5 bg-[#F3EFE6] px-3.5 py-2 rounded-xl border border-[#E6E0D4] min-h-[44px]">
            <span className="text-xs font-mono font-semibold text-[#2A2622] tabular-nums min-w-[58px]">
              {tempo} BPM
            </span>
            <input
              type="range"
              min={45}
              max={160}
              value={tempo}
              onChange={(e) => onTempoChange(Number(e.target.value))}
              aria-label="Practice Tempo in BPM"
              className="w-24 accent-[#B85D19] cursor-pointer"
            />
          </div>

          {extraRightActions}
        </div>
      </div>

      {/* Live Progress Scrub/Indicator Bar when playing or paused */}
      {(isPlaying || isPaused) && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-[#6A6258] tabular-nums">
            <span>
              {isPaused ? 'Paused' : 'Playing'} — Event{' '}
              {activeNoteIndex !== null ? activeNoteIndex + 1 : 1} of{' '}
              {sectionNotes.length} ({partName})
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#EAE4D8] overflow-hidden">
            <div
              style={{ width: `${progressPercent}%` }}
              className="h-full bg-[#B85D19] transition-all duration-150"
            />
          </div>
        </div>
      )}

      {/* Row 2: Download Practice Audio (MP3 & WAV) */}
      <div className="pt-3 border-t border-[#EAE4D8] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Volume2 className="w-4 h-4 text-[#B85D19] shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#2A2622]">
              Download Practice Audio ({partName})
            </span>
            <span className="text-[11px] text-[#78716C]">
              • Synthesized instrumental/choral reference audio matching your latest note corrections
            </span>
          </div>
          <p className="text-[11px] font-mono text-[#6A6258] truncate max-w-xl">
            File: {previewMp3Name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isSectionFiltered && (
            <select
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value as 'section' | 'full')}
              aria-label="Audio Export Scope"
              className="min-h-[44px] px-3 py-2 rounded-xl bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
            >
              <option value="section">
                Selected Section ({sectionNotes.length} events)
              </option>
              <option value="full">
                Entire Vocal Part ({fullPartNotes.length} events)
              </option>
            </select>
          )}

          <button
            type="button"
            onClick={() => handleDownloadAudio('mp3')}
            disabled={exportingFormat !== null || targetExportNotes.length === 0}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#2A2622] hover:bg-[#142F23] text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-xs disabled:opacity-50"
            title="Download genuine MP3 practice audio encoded via FFmpeg"
          >
            {exportingFormat === 'mp3' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Encoding MP3...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-[#DEAB3F]" />
                <span>Download MP3</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleDownloadAudio('wav')}
            disabled={exportingFormat !== null || targetExportNotes.length === 0}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white hover:bg-[#F3EFE6] text-[#2A2622] border border-[#DED8CC] text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            title="Download uncompressed 44.1 kHz 16-bit PCM WAV practice audio"
          >
            {exportingFormat === 'wav' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#B85D19]" />
                <span>Rendering WAV...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-[#B85D19]" />
                <span>Download WAV</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Export Status Feedback Banner */}
      {exportStatus && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 ${
            exportStatus.type === 'success'
              ? 'bg-[#EBF5EE] border border-[#C5E3CE] text-[#1F7A4C]'
              : 'bg-[#FDF2F2] border border-[#F5C2C7] text-[#991B1B]'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {exportStatus.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{exportStatus.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportStatus(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
