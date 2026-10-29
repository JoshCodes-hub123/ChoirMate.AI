import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Mic,
  MicOff,
  Play,
  RotateCcw,
  CheckCircle2,
  Volume2,
  Award,
  Sparkles,
  ArrowLeft,
  ChevronRight,
  Layers,
  Eye,
} from 'lucide-react';
import { ScoreAnalysis, VocalPart, MusicNote } from '../types/music';
import { InteractiveStave } from './InteractiveStave';
import { audioEngine, InstrumentVoice } from '../utils/audioPlayer';
import { PitchDetector, PitchDetectionResult } from '../utils/pitchDetector';
import { PracticeAudioBar } from './PracticeAudioBar';
import { VoiceQuestionPanel } from './VoiceQuestionPanel';


interface PracticeModeProps {
  score: ScoreAnalysis;
  selectedPartId: string;
  onSelectPart: (partId: string) => void;
  onBackToLearn: () => void;
}

export const PracticeMode: React.FC<PracticeModeProps> = ({
  score,
  selectedPartId,
  onSelectPart,
  onBackToLearn,
}) => {
  const parts: VocalPart[] = useMemo(() => {
    if (score.parts && score.parts.length > 0) {
      return score.parts.map((p, idx) => ({
        ...p,
        id: p.id || p.partId || `P${idx + 1}`,
      }));
    }
    return [
      {
        id: 'P1',
        name: 'Vocal Part 1',
        shortName: 'P1',
        clef: score.clef || 'treble',
        staffIndex: 1,
        notes: score.notes,
        measures: score.measures || [],
      },
    ];
  }, [score]);

  const activePart: VocalPart = useMemo(() => {
    return parts.find((p) => (p.id || p.partId) === selectedPartId) || parts[0];
  }, [parts, selectedPartId]);

  const getNoteSystem = (n: MusicNote): number => {
    if (typeof n.system === 'number') return n.system;
    if (typeof n.systemIndex === 'number') return n.systemIndex;
    return 1;
  };

  const getNotePage = (n: MusicNote): number => {
    if (typeof n.page === 'number') return n.page;
    if (typeof n.pageNumber === 'number') return n.pageNumber;
    return 1;
  };

  const getSystemGlobalNumber = (sys: { systemNumber?: number; systemIndex?: number }): number => {
    if (typeof sys.systemNumber === 'number') return sys.systemNumber;
    if (typeof sys.systemIndex === 'number') return sys.systemIndex;
    return 1;
  };

  // Practice scope: Full Song, by Page, by System, or Measure Range
  const [practiceScope, setPracticeScope] = useState<'all' | 'page' | 'system' | 'measures'>('all');
  const [selectedPageNum, setSelectedPageNum] = useState<number>(1);
  const [selectedSystemNum, setSelectedSystemNum] = useState<number>(1);
  const [startMeasure, setStartMeasure] = useState<number>(1);
  const [endMeasure, setEndMeasure] = useState<number>(4);
  const [showOriginalScoreRef, setShowOriginalScoreRef] = useState<boolean>(true);

  const pageImages = useMemo(() => {
    if (score.pageImages && score.pageImages.length > 0) return score.pageImages;
    if (score.imageUrl) return [score.imageUrl];
    return [];
  }, [score.pageImages, score.imageUrl]);

  const availablePages = useMemo(() => {
    const set = new Set<number>();
    for (let i = 1; i <= pageImages.length; i++) set.add(i);
    activePart.notes.forEach((n) => set.add(getNotePage(n)));
    return Array.from(set).sort((a, b) => a - b);
  }, [activePart, pageImages.length]);

  const availableSystems = useMemo(() => {
    const set = new Set<number>();
    activePart.notes.forEach((n) => set.add(getNoteSystem(n)));
    return Array.from(set).sort((a, b) => a - b);
  }, [activePart]);

  const availableMeasures = useMemo(() => {
    const set = new Set<number>();
    activePart.notes.forEach((n) => set.add(n.measure));
    return Array.from(set).sort((a, b) => a - b);
  }, [activePart]);

  const practiceNotes = useMemo(() => {
    return activePart.notes.filter((n) => {
      if (practiceScope === 'page') {
        return getNotePage(n) === selectedPageNum;
      }
      if (practiceScope === 'system') {
        return getNoteSystem(n) === selectedSystemNum;
      }
      if (practiceScope === 'measures') {
        const minM = Math.min(startMeasure, endMeasure);
        const maxM = Math.max(startMeasure, endMeasure);
        return n.measure >= minM && n.measure <= maxM;
      }
      return true;
    });
  }, [activePart, practiceScope, selectedPageNum, selectedSystemNum, startMeasure, endMeasure]);

  const [targetIndex, setTargetIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [livePitch, setLivePitch] = useState<PitchDetectionResult | null>(null);
  const [matchedNotes, setMatchedNotes] = useState<boolean[]>([]);
  const [micError, setMicError] = useState<string | null>(null);

  // Audio playback & export state in Practice Mode
  const [tempo, setTempo] = useState<number>(score.tempo || 88);
  const [voice, setVoice] = useState<InstrumentVoice>('choir');
  const [metronomeOn, setMetronomeOn] = useState<boolean>(false);
  const [isPlayingPhrase, setIsPlayingPhrase] = useState<boolean>(false);
  const [isPausedPhrase, setIsPausedPhrase] = useState<boolean>(false);
  const [loopPhrase, setLoopPhrase] = useState<boolean>(false);


  const detectorRef = useRef<PitchDetector | null>(null);
  const holdFramesRef = useRef(0);
  const targetIndexRef = useRef(targetIndex);
  targetIndexRef.current = targetIndex;

  useEffect(() => {
    setTargetIndex(0);
    setMatchedNotes(new Array(practiceNotes.length).fill(false));
    holdFramesRef.current = 0;
  }, [practiceNotes]);

  const targetNote = practiceNotes[targetIndex] || practiceNotes[0];

  useEffect(() => {
    return () => {
      detectorRef.current?.stop();
      audioEngine.stop();
    };
  }, []);

  const handleAdvanceRestOrNext = () => {
    setMatchedNotes((prev) => {
      const updated = [...prev];
      updated[targetIndex] = true;
      return updated;
    });
    if (targetIndex < practiceNotes.length - 1) {
      setTargetIndex((prev) => prev + 1);
    }
  };

  const startMicrophone = async () => {
    setMicError(null);
    if (!detectorRef.current) {
      detectorRef.current = new PitchDetector();
    }

    try {
      await detectorRef.current.start((result: PitchDetectionResult | null) => {
        setLivePitch(result);
        const currentIdx = targetIndexRef.current;
        const currentTarget = practiceNotes[currentIdx];
        if (!currentTarget) return;

        if (currentTarget.isRest || currentTarget.pitch === 'REST') {
          if (!result) {
            holdFramesRef.current += 1;
            if (holdFramesRef.current >= 4) {
              holdFramesRef.current = 0;
              setMatchedNotes((prev) => {
                const updated = [...prev];
                updated[currentIdx] = true;
                return updated;
              });
              if (currentIdx < practiceNotes.length - 1) {
                setTargetIndex(currentIdx + 1);
              }
            }
          }
          return;
        }

        if (!result) {
          holdFramesRef.current = Math.max(0, holdFramesRef.current - 1);
          return;
        }

        const semitoneDistance = Math.abs(
          12 * Math.log2(result.frequency / currentTarget.frequency)
        );

        if (semitoneDistance < 0.85) {
          holdFramesRef.current += 1;
          if (holdFramesRef.current >= 3) {
            holdFramesRef.current = 0;
            setMatchedNotes((prev) => {
              const updated = [...prev];
              updated[currentIdx] = true;
              return updated;
            });
            if (currentIdx < practiceNotes.length - 1) {
              setTargetIndex(currentIdx + 1);
            }
          }
        } else {
          holdFramesRef.current = Math.max(0, holdFramesRef.current - 1);
        }
      });
      setIsListening(true);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Could not access microphone. Please check browser permissions.';
      setMicError(msg);
      setIsListening(false);
    }
  };

  const stopMicrophone = () => {
    detectorRef.current?.stop();
    setIsListening(false);
    setLivePitch(null);
  };

  const handlePlayReferenceNote = () => {
    if (!targetNote || targetNote.isRest || targetNote.frequency <= 0) return;
    audioEngine.playNote(targetNote.frequency, 0.9, voice, targetNote.chordFrequencies);
  };

  const handlePlaySectionPhrase = () => {
    setIsPlayingPhrase(true);
    setIsPausedPhrase(false);
    audioEngine.playMelodySequence(
      practiceNotes,
      tempo,
      (idx) => {
        if (idx !== null) setTargetIndex(idx);
      },
      () => {
        setIsPlayingPhrase(false);
        setIsPausedPhrase(false);
      },
      {
        voice,
        metronome: metronomeOn,
        loop: loopPhrase,
      }
    );
  };

  const handlePausePhrase = () => {
    audioEngine.pause();
    setIsPausedPhrase(true);
    setIsPlayingPhrase(false);
  };

  const handleResumePhrase = () => {
    audioEngine.resume();
    setIsPausedPhrase(false);
    setIsPlayingPhrase(true);
  };

  const handleStopPhrase = () => {
    audioEngine.stop();
    setIsPlayingPhrase(false);
    setIsPausedPhrase(false);
  };

  const handleToggleLoopPhrase = () => {
    const next = !loopPhrase;
    setLoopPhrase(next);
    audioEngine.setLoop(next);
  };

  const practiceScopeLabel = useMemo(() => {
    if (practiceScope === 'page') return `page-${selectedPageNum}`;
    if (practiceScope === 'system') return `system-${selectedSystemNum}`;
    if (practiceScope === 'measures') {
      const minM = Math.min(startMeasure, endMeasure);
      const maxM = Math.max(startMeasure, endMeasure);
      return `measures-${minM}-to-${maxM}`;
    }
    return 'full-song';
  }, [practiceScope, selectedPageNum, selectedSystemNum, startMeasure, endMeasure]);


  const handleResetProgress = () => {
    setTargetIndex(0);
    setMatchedNotes(new Array(practiceNotes.length).fill(false));
    holdFramesRef.current = 0;
  };

  const completedCount = matchedNotes.filter(Boolean).length;
  const accuracyPercent =
    practiceNotes.length > 0 ? Math.round((completedCount / practiceNotes.length) * 100) : 0;

  let pitchHint = 'Sing the target Solfa syllable into your microphone';
  let pitchStatusColor = 'text-[#6A6258]';

  if (targetNote?.isRest || targetNote?.pitch === 'REST') {
    pitchHint = 'Rest event — hold silence or click Next Event to continue';
    pitchStatusColor = 'text-[#1F7A4C] font-semibold';
  } else if (livePitch && targetNote) {
    const diffSemitones = 12 * Math.log2(livePitch.frequency / targetNote.frequency);
    if (Math.abs(diffSemitones) < 0.85) {
      pitchHint = 'Spot on! Hold that pitch steady...';
      pitchStatusColor = 'text-[#1F7A4C] font-semibold';
    } else if (diffSemitones < -0.85) {
      pitchHint = 'A little flat (low) — raise your pitch slightly ↑';
      pitchStatusColor = 'text-[#B85D19]';
    } else {
      pitchHint = 'A little sharp (high) — relax and lower pitch slightly ↓';
      pitchStatusColor = 'text-[#B85D19]';
    }
  }

  const activeNotePageNum = targetNote ? getNotePage(targetNote) : 1;
  const pageImage =
    pageImages[Math.max(0, activeNotePageNum - 1)] || pageImages[0] || score.imageUrl;
  const keyLabel = score.keySignature?.key || 'C Major';
  const timeSigLabel = `${score.timeSignature?.numerator || 4}/${score.timeSignature?.denominator || 4}`;

  return (
    <div className="space-y-6">
      {/* Top Bar + Vocal Part & Section Filter */}
      <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBackToLearn}
              className="p-2 rounded-xl bg-[#F3EFE6] hover:bg-[#E6E0D4] text-[#2A2622] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#1F7A4C]">
                Interactive Sight-Singing Coach
              </span>
              <h2 className="text-xl font-serif font-bold text-[#2A2622]">
                {score.title} — {activePart.name}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-[#F3EFE6] border border-[#E6E0D4] flex items-center gap-2">
              <Award className="w-4 h-4 text-[#B85D19]" />
              <span className="text-xs font-semibold text-[#2A2622]">
                Progress: {completedCount} / {practiceNotes.length} ({accuracyPercent}%)
              </span>
            </div>

            <button
              onClick={handlePlaySectionPhrase}
              title="Synthesized Web Audio reference playback"
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F3EFE6] border border-[#DED8CC] text-xs font-semibold text-[#2A2622] flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 text-[#B85D19]" />
              Hear Synthesized Phrase
            </button>

            <button
              onClick={handleResetProgress}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F3EFE6] border border-[#DED8CC] text-xs font-semibold text-[#6A6258] flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>

        {/* Vocal Part & Section Scope Controls */}
        <div className="pt-3 border-t border-[#E6E0D4] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#6A6258] flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-[#B85D19]" />
              Part:
            </span>
            {parts.map((p) => {
              const pid = p.id || p.partId || 'P1';
              return (
                <button
                  key={pid}
                  onClick={() => onSelectPart(pid)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer border ${
                    pid === (activePart.id || activePart.partId)
                      ? 'bg-[#2A2622] text-white border-[#2A2622]'
                      : 'bg-white text-[#4A443C] border-[#DED8CC]'
                  }`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-[#6A6258]">Practice Scope:</span>
            <select
              value={practiceScope}
              onChange={(e) =>
                setPracticeScope(e.target.value as 'all' | 'page' | 'system' | 'measures')
              }
              className="px-2.5 py-1 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
            >
              <option value="all">Full Score ({activePart.notes.length} events)</option>
              {availablePages.length > 1 && <option value="page">Single Page</option>}
              {availableSystems.length > 1 && <option value="system">Single System (Line)</option>}
              <option value="measures">Measure Range</option>
            </select>

            {practiceScope === 'page' && (
              <select
                value={selectedPageNum}
                onChange={(e) => setSelectedPageNum(Number(e.target.value))}
                className="px-2.5 py-1 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
              >
                {availablePages.map((pNum) => (
                  <option key={pNum} value={pNum}>
                    Page {pNum}
                  </option>
                ))}
              </select>
            )}

            {practiceScope === 'system' && (
              <select
                value={selectedSystemNum}
                onChange={(e) => setSelectedSystemNum(Number(e.target.value))}
                className="px-2.5 py-1 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
              >
                {availableSystems.map((sNum) => (
                  <option key={sNum} value={sNum}>
                    System {sNum}
                  </option>
                ))}
              </select>
            )}

            {practiceScope === 'measures' && (
              <div className="flex items-center gap-1.5 text-xs">
                <span>m.</span>
                <select
                  value={startMeasure}
                  onChange={(e) => setStartMeasure(Number(e.target.value))}
                  className="px-2 py-1 rounded bg-white border border-[#DED8CC] font-mono"
                >
                  {availableMeasures.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span>to</span>
                <select
                  value={endMeasure}
                  onChange={(e) => setEndMeasure(Number(e.target.value))}
                  className="px-2 py-1 rounded bg-white border border-[#DED8CC] font-mono"
                >
                  {availableMeasures.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {pageImage && (
              <button
                type="button"
                onClick={() => setShowOriginalScoreRef(!showOriginalScoreRef)}
                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F3EFE6] text-xs font-semibold text-[#2A2622] cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-[#B85D19]" />
                {showOriginalScoreRef ? 'Hide Original Score' : 'Show Original Score'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Practice Audio Transport & Download Bar (MP3 & WAV) */}
      <PracticeAudioBar
        title={score.title}
        partName={activePart.name}
        fullPartNotes={activePart.notes}
        sectionNotes={practiceNotes}
        sectionLabel={practiceScopeLabel}
        tempo={tempo}
        onTempoChange={setTempo}
        voice={voice}
        onVoiceChange={setVoice}
        metronomeOn={metronomeOn}
        onMetronomeToggle={() => setMetronomeOn((m) => !m)}
        isPlaying={isPlayingPhrase}
        isPaused={isPausedPhrase}
        loopEnabled={loopPhrase}
        activeNoteIndex={targetIndex}
        onPlay={handlePlaySectionPhrase}
        onPause={handlePausePhrase}
        onResume={handleResumePhrase}
        onRestart={handlePlaySectionPhrase}
        onStop={handleStopPhrase}
        onToggleLoop={handleToggleLoopPhrase}
      />


      {/* Synchronized Original Score Strip */}
      {pageImage && showOriginalScoreRef && (
        <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#6A6258]">
              Original Score Location — Page {activeNotePageNum} of {Math.max(1, pageImages.length)}, System{' '}
              {targetNote ? getNoteSystem(targetNote) : 1}, Measure {targetNote?.measure ?? 1}
            </span>
          </div>
          <div className="relative max-h-56 overflow-y-auto bg-white border border-[#EAE4D8] rounded-xl p-2">
            <div className="relative max-w-3xl mx-auto">
              <img
                src={pageImage}
                alt="Original score reference in practice mode"
                className="w-full h-auto block rounded"
              />
              {score.systemsMetadata &&
                score.systemsMetadata
                  .filter((sys) => (sys.page || sys.pageNumber || 1) === activeNotePageNum)
                  .map((sys) => {
                    const sysNum = getSystemGlobalNumber(sys);
                    const isTargetSys = (targetNote ? getNoteSystem(targetNote) : 1) === sysNum;
                    if (!isTargetSys) return null;
                    return (
                      <div
                        key={sysNum}
                        style={{
                          left: `${sys.bbox.x * 100}%`,
                          top: `${sys.bbox.y * 100}%`,
                          width: `${sys.bbox.width * 100}%`,
                          height: `${sys.bbox.height * 100}%`,
                        }}
                        className="absolute border-2 border-[#1F7A4C] bg-[#1F7A4C]/12 rounded pointer-events-none"
                      />
                    );
                  })}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Stave Focusing on Active Target Note */}
      <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 shadow-sm">
        <div className="bg-white border border-[#EAE4D8] rounded-xl p-4">
          <InteractiveStave
            notes={practiceNotes}
            activeNoteIndex={targetIndex}
            onNoteClick={(_, idx) => setTargetIndex(idx)}
            keySignature={keyLabel}
            timeSignature={timeSigLabel}
            clef={activePart.clef}
          />
        </div>

        {/* Step-by-Step Note Progress Pills */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {practiceNotes.map((note, idx) => {
            const isDone = matchedNotes[idx];
            const isCurrent = idx === targetIndex;
            const isRest = Boolean(note.isRest || note.pitch === 'REST');
            return (
              <button
                key={idx}
                onClick={() => setTargetIndex(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  isCurrent
                    ? 'bg-[#B85D19] text-white border-[#B85D19] ring-2 ring-[#B85D19]/30'
                    : isDone
                    ? 'bg-[#EBF5EE] text-[#1F7A4C] border-[#B7E1C7]'
                    : 'bg-white text-[#6A6258] border-[#E6E0D4]'
                }`}
              >
                {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{isRest ? 'Rest' : note.solfa}</span>
                <span className="text-[10px] font-mono opacity-75">
                  ({isRest ? `m.${note.measure}` : note.pitch})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Pitch Detection & Target Note Card */}
      {targetNote && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#B85D19]">
                Target Event ({targetIndex + 1} of {practiceNotes.length} • Measure {targetNote.measure})
              </span>
              <div className="flex items-baseline gap-4 mt-3">
                <span className="text-5xl font-serif font-bold text-[#2A2622]">
                  {targetNote.isRest ? 'Rest' : targetNote.solfa}
                </span>
                <span className="text-xl font-mono font-semibold text-[#6A6258]">
                  {targetNote.isRest ? `(${targetNote.durationName || targetNote.duration})` : targetNote.pitch}
                </span>
                {!targetNote.isRest && (
                  <span className="text-xs font-mono text-[#8C8274]">
                    {targetNote.frequency} Hz
                  </span>
                )}
              </div>
              <p className="text-xs text-[#6A6258] mt-2">
                {targetNote.isRest
                  ? `Hold silence for a ${targetNote.durationName || 'rest'} in Measure ${targetNote.measure}.`
                  : `Listen to the synthesized reference tone first, then sing "${targetNote.solfa}" clearly.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-[#EAE4D8]">
              {!targetNote.isRest && (
                <button
                  onClick={handlePlayReferenceNote}
                  className="px-4 py-2.5 rounded-xl bg-[#F3EFE6] hover:bg-[#E6E0D4] text-xs font-semibold text-[#2A2622] flex items-center gap-2 cursor-pointer"
                >
                  <Volume2 className="w-4 h-4 text-[#B85D19]" />
                  Play Target Pitch
                </button>
              )}

              <button
                onClick={handleAdvanceRestOrNext}
                className="px-4 py-2.5 rounded-xl bg-white hover:bg-[#F3EFE6] border border-[#DED8CC] text-xs font-semibold text-[#6A6258] flex items-center gap-1.5 cursor-pointer"
              >
                {targetNote.isRest ? 'Mark Rest Complete' : 'Next Note'}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#6A6258]">
                  Your Live Voice Pitch
                </span>
                {isListening && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F7A4C]">
                    <span className="w-2 h-2 rounded-full bg-[#1F7A4C]" />
                    Microphone Active
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline gap-4">
                <span className="text-4xl font-mono font-bold text-[#2A2622] tabular-nums">
                  {livePitch ? livePitch.note : '--'}
                </span>
                <span className="text-sm font-mono text-[#78716C] tabular-nums">
                  {livePitch ? `${livePitch.frequency} Hz` : 'No voice detected'}
                </span>
              </div>

              <p className={`text-xs mt-3 ${pitchStatusColor}`}>{pitchHint}</p>

              {micError && (
                <p className="text-xs text-[#991B1B] bg-[#FDF2F2] p-2.5 rounded-lg mt-3 border border-[#F8D7DA]">
                  {micError}
                </p>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-[#EAE4D8] flex items-center justify-between">
              {!isListening ? (
                <button
                  type="button"
                  onClick={startMicrophone}
                  className="min-h-[44px] w-full py-3 px-5 rounded-xl bg-[#1F7A4C] hover:bg-[#18633D] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Mic className="w-4 h-4" />
                  <span>Start Microphone Pitch Coach</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopMicrophone}
                  className="min-h-[44px] w-full py-3 px-5 rounded-xl bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MicOff className="w-4 h-4" />
                  <span>Stop Microphone</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Completion Banner */}
      {accuracyPercent === 100 && practiceNotes.length > 0 && (
        <div className="bg-[#EBF5EE] border border-[#B7E1C7] rounded-2xl p-6 text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-[#1F7A4C] text-white flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-serif font-bold text-[#14532D]">
            Section Mastered!
          </h3>
          <p className="text-xs text-[#166534] max-w-md mx-auto">
            You completed all {practiceNotes.length} musical events in this section of {score.title}. Try switching vocal parts or selecting the next system!
          </p>
        </div>
      )}

      {/* Interactive Voice & Text Music Q&A in Practice Mode */}
      <VoiceQuestionPanel
        score={score}
        activePart={activePart}
        displayedNotes={practiceNotes}
      />
    </div>
  );
};

