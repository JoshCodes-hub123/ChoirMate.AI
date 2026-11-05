import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  Download,
  FileUp,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Volume2,
  AlertCircle,
} from 'lucide-react';
import {
  ScoreAnalysis,
  ScoreProvenance,
  VoiceStudioNote,
  VoiceStudioVoice,
} from '../types/music';
import {
  ChoirMateApiError,
  extractVoicesFromMusicXml,
  synthesizeVoiceStudioAudio,
} from '../services/api';
import { generateMusicXml } from '../utils/musicXmlExport';
import { SAMPLE_SCORES } from '../data/sampleScores';

interface VoiceStudioProps {
  score: ScoreAnalysis | null;
  scoreProvenance?: ScoreProvenance | null;
  onUploadNewScore?: () => void;
  onSelectDemoScore?: (score: ScoreAnalysis) => void;
}

type SATBRole = 'soprano' | 'alto' | 'tenor' | 'bass' | 'other';

function classifyVoiceRole(voice: VoiceStudioVoice, index: number): SATBRole {
  const label = `${voice.partName} ${voice.partId} ${voice.id}`.toLowerCase();
  if (label.includes('soprano') || /\bs1\b|\bs2\b|^s$/i.test(voice.partId)) return 'soprano';
  if (label.includes('alto') || /\ba1\b|\ba2\b|^a$/i.test(voice.partId)) return 'alto';
  if (label.includes('tenor') || /\bt1\b|\bt2\b|^t$/i.test(voice.partId)) return 'tenor';
  if (label.includes('bass') || label.includes('baritone') || /\bb1\b|\bb2\b|^b$/i.test(voice.partId))
    return 'bass';

  const order: SATBRole[] = ['soprano', 'alto', 'tenor', 'bass'];
  return order[index % 4] || 'other';
}

const ROLE_STYLES: Record<
  SATBRole,
  {
    badge: string;
    borderActive: string;
    bgActive: string;
    accentColor: string;
    label: string;
  }
> = {
  soprano: {
    badge: 'bg-[#E9F3EC] text-[#143826] border-[#B8D8C4]',
    borderActive: 'border-[#143826]',
    bgActive: 'bg-[#F3F8F5]',
    accentColor: '#143826',
    label: 'Soprano',
  },
  alto: {
    badge: 'bg-[#FDF6E4] text-[#8B6914] border-[#E8CF8C]',
    borderActive: 'border-[#9E7B35]',
    bgActive: 'bg-[#FCF8EE]',
    accentColor: '#9E7B35',
    label: 'Alto',
  },
  tenor: {
    badge: 'bg-[#EEF2F6] text-[#1E3A5F] border-[#C2D1E5]',
    borderActive: 'border-[#1E3A5F]',
    bgActive: 'bg-[#F4F7FA]',
    accentColor: '#1E3A5F',
    label: 'Tenor',
  },
  bass: {
    badge: 'bg-[#F4EFEA] text-[#4A2E1B] border-[#D8C5B4]',
    borderActive: 'border-[#4A2E1B]',
    bgActive: 'bg-[#F9F6F3]',
    accentColor: '#4A2E1B',
    label: 'Bass',
  },
  other: {
    badge: 'bg-[#F2ECE1] text-[#334239] border-[#DFD6C3]',
    borderActive: 'border-[#143826]',
    bgActive: 'bg-[#F7F4EC]',
    accentColor: '#143826',
    label: 'Vocal Part',
  },
};

function computeVoiceStats(notes: VoiceStudioNote[]) {
  const sung = notes.filter((n) => !n.isRest && n.frequency > 0 && n.pitch !== 'REST');
  const rests = notes.length - sung.length;
  const totalBeats = notes.reduce((acc, n) => acc + (Number(n.duration) || 0), 0);

  if (sung.length === 0) {
    return {
      sungCount: 0,
      restCount: rests,
      totalBeats: Math.round(totalBeats * 10) / 10,
      rangeText: 'Rest only',
      samplePitches: [] as string[],
    };
  }

  let lowest = sung[0];
  let highest = sung[0];
  for (const n of sung) {
    if (n.frequency < lowest.frequency) lowest = n;
    if (n.frequency > highest.frequency) highest = n;
  }

  const samplePitches = sung.slice(0, 8).map((n) => n.pitch);

  return {
    sungCount: sung.length,
    restCount: rests,
    totalBeats: Math.round(totalBeats * 10) / 10,
    rangeText:
      lowest.pitch === highest.pitch ? lowest.pitch : `${lowest.pitch} – ${highest.pitch}`,
    samplePitches,
  };
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const VoiceStudio: React.FC<VoiceStudioProps> = ({
  score,
  scoreProvenance,
  onUploadNewScore,
  onSelectDemoScore,
}) => {
  const [voices, setVoices] = useState<VoiceStudioVoice[]>([]);
  const [selectedVoiceIds, setSelectedVoiceIds] = useState<string[]>([]);
  const [tempo, setTempo] = useState<number>(score?.tempo || 92);

  // Direct MusicXML file override inside Voice Studio
  const [customMusicXml, setCustomMusicXml] = useState<string | null>(null);
  const [customXmlTitle, setCustomXmlTitle] = useState<string | null>(null);

  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio playback state
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [lastRenderedSummary, setLastRenderedSummary] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Compute the active MusicXML string from custom upload or active score
  const activeMusicXml = useMemo(() => {
    if (customMusicXml) return customMusicXml;
    if (!score) return '';
    if (score.rawMusicXml && score.rawMusicXml.trim().length > 0) {
      return score.rawMusicXml;
    }
    return generateMusicXml(score);
  }, [customMusicXml, score]);

  const activeTitle = customXmlTitle || score?.title || 'Choral Score';
  const isDemo = Boolean(!customMusicXml && (score?.isDemonstration || scoreProvenance === 'demo'));

  // Sync default tempo when score changes
  useEffect(() => {
    if (score?.tempo) {
      setTempo(score.tempo);
    }
    setCustomMusicXml(null);
    setCustomXmlTitle(null);
  }, [score?.id]);

  // Extract SATB voices from Python backend whenever activeMusicXml changes
  useEffect(() => {
    if (!activeMusicXml) {
      setVoices([]);
      setSelectedVoiceIds([]);
      setAudioDataUrl(null);
      setErrorMessage(null);
      return;
    }

    abortControllerRef.current?.abort();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    setIsLoadingVoices(true);
    setErrorMessage(null);
    setAudioDataUrl(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    extractVoicesFromMusicXml(activeMusicXml, ctrl.signal)
      .then((extracted) => {
        setVoices(extracted);
        setSelectedVoiceIds(extracted.map((v) => v.id));
        setIsLoadingVoices(false);
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError') return;
        setIsLoadingVoices(false);
        setVoices([]);
        setSelectedVoiceIds([]);
        setErrorMessage(
          err instanceof ChoirMateApiError
            ? err.message
            : err?.message || 'Could not extract SATB voices from the active score.'
        );
      });

    return () => {
      ctrl.abort();
    };
  }, [activeMusicXml]);

  const toggleVoiceSelection = (voiceId: string) => {
    setSelectedVoiceIds((prev) =>
      prev.includes(voiceId) ? prev.filter((id) => id !== voiceId) : [...prev, voiceId]
    );
  };

  const handleSoloVoice = (voiceId: string) => {
    setSelectedVoiceIds([voiceId]);
  };

  const handleSelectAllVoices = () => {
    setSelectedVoiceIds(voices.map((v) => v.id));
  };

  const handleUploadDirectMusicXml = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomMusicXml(reader.result);
        setCustomXmlTitle(file.name.replace(/\.(musicxml|xml)$/i, ''));
      }
    };
    reader.readAsText(file);
  };

  const handleGenerateAudio = async (overrideVoiceIds?: string[]) => {
    const targetVoiceIds = overrideVoiceIds ?? selectedVoiceIds;
    if (!activeMusicXml || targetVoiceIds.length === 0) return;

    setIsGeneratingAudio(true);
    setErrorMessage(null);

    try {
      const result = await synthesizeVoiceStudioAudio(
        activeMusicXml,
        targetVoiceIds,
        tempo
      );

      if (!result.audioBase64) {
        throw new Error('Backend returned empty audio data.');
      }

      const mime = result.mimeType || 'audio/wav';
      const dataUrl = `data:${mime};base64,${result.audioBase64}`;
      setAudioDataUrl(dataUrl);

      const selectedNames = voices
        .filter((v) => targetVoiceIds.includes(v.id))
        .map((v) => v.partName)
        .join(' + ');
      setLastRenderedSummary(`${selectedNames || 'Selected Voices'} @ ${tempo} BPM`);

      // Automatically play once loaded
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current
            .play()
            .then(() => setIsPlaying(true))
            .catch(() => setIsPlaying(false));
        }
      }, 80);
    } catch (err: any) {
      setErrorMessage(
        err instanceof ChoirMateApiError
          ? err.message
          : err?.message || 'Failed to generate SATB rehearsal audio.'
      );
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleTogglePlayPause = () => {
    const el = audioRef.current;
    if (!el || !audioDataUrl) return;
    if (el.paused) {
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const handleRestartAudio = () => {
    const el = audioRef.current;
    if (!el || !audioDataUrl) return;
    el.currentTime = 0;
    setCurrentTime(0);
    el.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  const handleDownloadWav = () => {
    if (!audioDataUrl) return;
    const cleanTitle = activeTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const a = document.createElement('a');
    a.href = audioDataUrl;
    a.download = `${cleanTitle || 'choirmate'}-satb-${tempo}bpm.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Empty state if no score is loaded yet
  if (!score && !customMusicXml) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-12 text-[#16221A]">
        <div className="bg-white rounded-2xl border border-[#DFD6C3] p-8 sm:p-12 text-center space-y-6 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-[#143826]/10 text-[#143826] flex items-center justify-center mx-auto">
            <AudioLines className="w-8 h-8" />
          </div>
          <div className="max-w-xl mx-auto space-y-2">
            <span className="text-xs font-bold uppercase tracking-widest text-[#9E7B35]">
              SATB Voice Studio
            </span>
            <h1 className="font-serif text-3xl font-bold text-[#143826]">
              No Score Loaded for Voice Isolation
            </h1>
            <p className="text-sm text-[#4F5F56] leading-relaxed">
              Upload your own MusicXML or sheet music score to extract Soprano, Alto, Tenor, and Bass vocal parts, or load a labeled Demo Score below to test synchronized rehearsal audio.
            </p>
          </div>

          <input
            ref={xmlInputRef}
            type="file"
            accept=".musicxml,.xml,text/xml,application/xml"
            className="hidden"
            onChange={handleUploadDirectMusicXml}
          />

          <div className="flex flex-wrap items-center justify-center gap-3">
            {onUploadNewScore && (
              <button
                type="button"
                onClick={onUploadNewScore}
                className="px-5 py-3 rounded-xl bg-[#143826] hover:bg-[#1B4B33] text-white text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer"
              >
                <FileUp className="w-4 h-4" />
                <span>Go to Score Upload Workspace</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => xmlInputRef.current?.click()}
              className="px-5 py-3 rounded-xl border border-[#143826] text-[#143826] hover:bg-[#143826]/5 text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Music className="w-4 h-4" />
              <span>Upload MusicXML (.xml) Directly</span>
            </button>
          </div>

          {onSelectDemoScore && (
            <div className="pt-6 border-t border-[#EAE2D2] max-w-2xl mx-auto">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#8B6914] mb-3">
                Or Test with a Labeled Demo Score:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SAMPLE_SCORES.map((demo) => (
                  <button
                    key={demo.id}
                    type="button"
                    onClick={() => onSelectDemoScore(demo)}
                    className="p-3 rounded-xl border border-[#E2D9C5] bg-[#FAF5ED] hover:border-[#143826] text-left transition-all cursor-pointer"
                  >
                    <span className="text-[10px] font-bold uppercase text-[#8B6914] block">
                      Demo Score
                    </span>
                    <span className="text-xs font-bold text-[#143826] block mt-0.5 truncate">
                      {demo.title}
                    </span>
                    <span className="text-[11px] text-[#5D6D63] block">
                      {(demo.parts || []).length} Parts • {demo.tempo} BPM
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-8 sm:py-10 text-[#16221A] space-y-8">
      {/* Hidden Direct MusicXML File Input */}
      <input
        ref={xmlInputRef}
        type="file"
        accept=".musicxml,.xml,text/xml,application/xml"
        className="hidden"
        onChange={handleUploadDirectMusicXml}
      />

      {/* Top Studio Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#DFD6C3]">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold uppercase tracking-widest text-[#9E7B35]">
              SATB Voice Studio • Python Audio Synthesizer
            </span>
            <span
              className={`text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-md border ${
                isDemo
                  ? 'bg-[#FDF6E4] text-[#8B6914] border-[#E8CF8C]'
                  : 'bg-[#E9F3EC] text-[#143826] border-[#B8D8C4]'
              }`}
            >
              {isDemo ? 'Demo Score Mode' : 'Uploaded Score'}
            </span>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#143826] mt-1">
            {activeTitle}
          </h1>
          <p className="text-sm text-[#4F5F56] mt-1">
            Isolate your vocal part, combine any SATB voices for duet or ensemble balance, adjust rehearsal tempo, and synthesize 44.1kHz WAV audio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => xmlInputRef.current?.click()}
            className="px-3.5 py-2.5 rounded-xl border border-[#D4C7B0] bg-white hover:bg-[#FCF9F3] text-[#143826] text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5 text-[#9E7B35]" />
            <span>Load MusicXML File</span>
          </button>

          {onUploadNewScore && (
            <button
              type="button"
              onClick={onUploadNewScore}
              className="px-3.5 py-2.5 rounded-xl bg-[#143826] hover:bg-[#1B4B33] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#D6B872]" />
              <span>Upload New Score</span>
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          className="bg-[#FDF2F2] border-2 border-[#E6B8B8] rounded-2xl p-5 text-[#7F1D1D] flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm space-y-1">
            <p className="font-bold">SATB Voice Studio Error</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left 8 Columns: Extracted Vocal Parts */}
        <div className="lg:col-span-8 space-y-5">
          {/* Quick Ensemble Combination Bar */}
          <div className="bg-white rounded-2xl border border-[#DFD6C3] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AudioLines className="w-4 h-4 text-[#143826]" />
              <span className="text-xs font-bold text-[#143826]">
                Extracted Vocal Parts ({voices.length})
              </span>
              <span className="text-xs text-[#637269]">
                • {selectedVoiceIds.length} selected for mix
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllVoices}
                disabled={voices.length === 0}
                className="px-3 py-1.5 rounded-lg bg-[#F2ECE1] hover:bg-[#E5DEC9] text-[#143826] text-xs font-semibold transition-colors cursor-pointer"
              >
                Full Choir (All {voices.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedVoiceIds([])}
                disabled={selectedVoiceIds.length === 0}
                className="px-3 py-1.5 rounded-lg border border-[#DFD6C3] hover:bg-[#FAF5ED] text-[#5D6D63] text-xs font-semibold transition-colors cursor-pointer"
              >
                Clear Mix
              </button>
            </div>
          </div>

          {/* Voice Cards */}
          {isLoadingVoices ? (
            <div className="bg-white rounded-2xl border border-[#DFD6C3] p-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#143826] mx-auto" />
              <p className="text-sm font-semibold text-[#143826]">
                Extracting SATB voices and staff timelines from Python engine...
              </p>
            </div>
          ) : voices.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#DFD6C3] p-10 text-center space-y-2">
              <p className="text-sm font-semibold text-[#143826]">
                No vocal parts were found in this MusicXML payload.
              </p>
              <p className="text-xs text-[#5D6D63]">
                Try uploading a multi-part MusicXML score or selecting another score.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {voices.map((voice, idx) => {
                const role = classifyVoiceRole(voice, idx);
                const style = ROLE_STYLES[role];
                const isSelected = selectedVoiceIds.includes(voice.id);
                const isSolo =
                  selectedVoiceIds.length === 1 && selectedVoiceIds[0] === voice.id;
                const stats = computeVoiceStats(voice.notes || []);

                return (
                  <div
                    key={voice.id}
                    className={`rounded-2xl border-2 p-5 transition-all flex flex-col justify-between ${
                      isSelected
                        ? `${style.borderActive} ${style.bgActive} shadow-sm`
                        : 'border-[#E2D9C5] bg-white opacity-85 hover:opacity-100'
                    }`}
                  >
                    <div>
                      {/* Top Row: Role Badge + Selection Checkbox */}
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md border ${style.badge}`}
                            >
                              {style.label}
                            </span>
                            <span className="font-mono text-[11px] text-[#5D6D63]">
                              Staff {voice.staffIndex + 1} • Voice {voice.voiceId}
                            </span>
                          </div>
                          <h3 className="font-serif text-xl font-bold text-[#143826] mt-1.5">
                            {voice.partName || `Part ${voice.partId}`}
                          </h3>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleVoiceSelection(voice.id)}
                          aria-pressed={isSelected}
                          className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                            isSelected
                              ? 'bg-[#143826] border-[#143826] text-white'
                              : 'bg-white border-[#C9BEA9] text-transparent hover:border-[#143826]'
                          }`}
                          title={isSelected ? 'Remove from mix' : 'Add to mix'}
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Voice Metadata Grid */}
                      <div className="grid grid-cols-3 gap-2 py-3 border-y border-[#E6DEC8] text-xs">
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#637269] block">
                            Sung Notes
                          </span>
                          <span className="font-mono font-bold text-[#16221A]">
                            {stats.sungCount}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#637269] block">
                            Pitch Range
                          </span>
                          <span className="font-mono font-bold text-[#16221A]">
                            {stats.rangeText}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#637269] block">
                            Total Beats
                          </span>
                          <span className="font-mono font-bold text-[#16221A]">
                            {stats.totalBeats}
                          </span>
                        </div>
                      </div>

                      {/* Opening Pitches Preview */}
                      {stats.samplePitches.length > 0 && (
                        <div className="mt-3">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#637269] block mb-1">
                            Opening Notes:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {stats.samplePitches.map((p, pIdx) => (
                              <span
                                key={pIdx}
                                className="font-mono text-[11px] px-2 py-0.5 rounded bg-white border border-[#DFD6C3] text-[#143826]"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons for This Voice */}
                    <div className="mt-4 pt-3 border-t border-[#E6DEC8] flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleSoloVoice(voice.id);
                          handleGenerateAudio([voice.id]);
                        }}
                        disabled={isGeneratingAudio}
                        className="flex-1 py-2 px-3 rounded-xl bg-[#143826] hover:bg-[#1B4B33] disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{isSolo ? 'Play Solo' : 'Solo & Play'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleVoiceSelection(voice.id)}
                        className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-[#143826]/30 bg-white text-[#143826] hover:bg-[#FAF5ED]'
                            : 'border-[#D4C7B0] bg-[#FAF5ED] text-[#526258] hover:text-[#143826]'
                        }`}
                      >
                        {isSelected ? 'In Mix ✓' : '+ Add to Mix'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right 4 Columns: Tempo Console, Synthesis Trigger & Audio Player */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl border border-[#DFD6C3] p-6 space-y-6 shadow-xs sticky top-24">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#9E7B35]">
                Master Rehearsal Console
              </span>
              <h2 className="font-serif text-xl font-bold text-[#143826] mt-0.5">
                Mix & Tempo Controls
              </h2>
            </div>

            {/* Tempo Control */}
            <div className="space-y-3 bg-[#FAF5ED] p-4 rounded-xl border border-[#E6DEC8]">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="studio-tempo-slider"
                  className="text-xs font-semibold text-[#143826] flex items-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5 text-[#9E7B35]" />
                  <span>Rehearsal Tempo</span>
                </label>
                <span className="font-mono text-sm font-bold text-[#143826] bg-white px-2.5 py-0.5 rounded-md border border-[#DFD6C3]">
                  {tempo} BPM
                </span>
              </div>

              <input
                id="studio-tempo-slider"
                type="range"
                min={36}
                max={220}
                value={tempo}
                onChange={(e) => setTempo(Number(e.target.value))}
                className="w-full accent-[#143826] cursor-pointer"
              />

              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { label: 'Slow (68)', bpm: 68 },
                  { label: `Score (${score?.tempo || 88})`, bpm: score?.tempo || 88 },
                  { label: 'Brisk (112)', bpm: 112 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setTempo(preset.bpm)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                      tempo === preset.bpm
                        ? 'bg-[#143826] text-white border-[#143826]'
                        : 'bg-white text-[#4F5F56] border-[#DFD6C3] hover:border-[#143826]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Mix Button */}
            <button
              type="button"
              onClick={() => handleGenerateAudio()}
              disabled={
                isGeneratingAudio || isLoadingVoices || selectedVoiceIds.length === 0
              }
              className="w-full py-3.5 px-5 rounded-xl bg-[#143826] hover:bg-[#1B4B33] disabled:opacity-45 text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              {isGeneratingAudio ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Synthesizing SATB WAV...</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 text-[#D6B872]" />
                  <span>
                    Generate Practice Audio ({selectedVoiceIds.length}{' '}
                    {selectedVoiceIds.length === 1 ? 'Voice' : 'Voices'})
                  </span>
                </>
              )}
            </button>

            {/* Custom Studio Audio Player */}
            <div className="pt-4 border-t border-[#EAE2D2] space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#143826]">
                  Synthesized Audio Output
                </span>
                {lastRenderedSummary && (
                  <span className="text-[11px] text-[#637269] truncate max-w-[180px]">
                    {lastRenderedSummary}
                  </span>
                )}
              </div>

              <audio
                ref={audioRef}
                src={audioDataUrl || undefined}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration || 0);
                }}
                onTimeUpdate={(e) => {
                  setCurrentTime(e.currentTarget.currentTime || 0);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                className="hidden"
              />

              {audioDataUrl ? (
                <div className="bg-[#16221A] text-white rounded-2xl p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTogglePlayPause}
                        className="w-10 h-10 rounded-xl bg-[#9E7B35] hover:bg-[#B38D40] text-white flex items-center justify-center transition-colors cursor-pointer"
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                      >
                        {isPlaying ? (
                          <Pause className="w-5 h-5" />
                        ) : (
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleRestartAudio}
                        className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                        title="Restart track"
                        aria-label="Restart track"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="text-right font-mono text-xs text-[#D6B872]">
                      {formatSeconds(currentTime)} / {formatSeconds(duration)}
                    </div>
                  </div>

                  {/* Scrubber */}
                  <input
                    type="range"
                    min={0}
                    max={duration > 0 ? duration : 1}
                    step={0.05}
                    value={currentTime}
                    onChange={(e) => {
                      const nextTime = Number(e.target.value);
                      setCurrentTime(nextTime);
                      if (audioRef.current) {
                        audioRef.current.currentTime = nextTime;
                      }
                    }}
                    className="w-full accent-[#9E7B35] cursor-pointer"
                    aria-label="Seek rehearsal audio"
                  />

                  <button
                    type="button"
                    onClick={handleDownloadWav}
                    className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#D6B872]" />
                    <span>Download Synthesized WAV (44.1 kHz)</span>
                  </button>
                </div>
              ) : (
                <div className="p-5 rounded-xl bg-[#FAF5ED] border border-[#E6DEC8] text-center text-xs text-[#5D6D63]">
                  Select one or more vocal parts on the left and click{' '}
                  <strong className="text-[#143826]">Generate Practice Audio</strong> to render synchronized SATB audio.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
