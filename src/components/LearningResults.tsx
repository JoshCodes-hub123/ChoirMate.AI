import React, { useState, useEffect, useMemo } from 'react';
import {
  Play,
  Square,
  Volume2,
  BookOpen,
  Sparkles,
  Music2,
  Clock,
  ArrowRight,
  Mic,
  Piano,
  Download,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Layers,
  RefreshCw,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Columns,
  FileText,
} from 'lucide-react';
import { ScoreAnalysis, MusicNote, VocalPart } from '../types/music';
import { InteractiveStave } from './InteractiveStave';
import { audioEngine, InstrumentVoice } from '../utils/audioPlayer';
import { downloadMusicXml } from '../utils/musicXmlExport';
import { PracticeAudioBar } from './PracticeAudioBar';
import { VoiceQuestionPanel } from './VoiceQuestionPanel';
import { getApiUrl } from '../utils/apiConfig';


interface LearningResultsProps {
  score: ScoreAnalysis;
  selectedPartId: string;
  onSelectPart: (partId: string) => void;
  onScoreUpdated: (updatedScore: ScoreAnalysis) => void;
  onStartPractice: () => void;
}

const VALID_PITCH_STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const VALID_ACCIDENTALS = ['', '#', 'b'];
const VALID_OCTAVES = ['2', '3', '4', '5', '6'];
const VALID_DURATIONS: { label: string; beats: number }[] = [
  { label: 'Whole (4 beats)', beats: 4 },
  { label: 'Dotted Half (3 beats)', beats: 3 },
  { label: 'Half (2 beats)', beats: 2 },
  { label: 'Dotted Quarter (1.5 beats)', beats: 1.5 },
  { label: 'Quarter (1 beat)', beats: 1 },
  { label: 'Dotted Eighth (0.75 beat)', beats: 0.75 },
  { label: 'Eighth (0.5 beat)', beats: 0.5 },
  { label: 'Sixteenth (0.25 beat)', beats: 0.25 },
];

export const LearningResults: React.FC<LearningResultsProps> = ({
  score,
  selectedPartId,
  onSelectPart,
  onScoreUpdated,
  onStartPractice,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [activeNoteIndex, setActiveNoteIndex] = useState<number | null>(null);
  const [tempo, setTempo] = useState(score.tempo || 88);
  const [selectedNote, setSelectedNote] = useState<MusicNote | null>(null);
  const [voice, setVoice] = useState<InstrumentVoice>('choir');
  const [metronomeOn, setMetronomeOn] = useState(false);


  // Original score reference vs optional Reconstructed Interactive Stave + Zoom & Layout
  const [showReconstructedStave, setShowReconstructedStave] = useState(true);
  const [sideBySideView, setSideBySideView] = useState(true);
  const [mobileViewTab, setMobileViewTab] = useState<'both' | 'original' | 'recognized'>('both');
  const [zoomPercent, setZoomPercent] = useState<number>(100);

  // Page, System, and Measure filters
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [selectedPageFilter, setSelectedPageFilter] = useState<number | 'all'>('all');
  const [selectedSystemFilter, setSelectedSystemFilter] = useState<number | 'all'>('all');
  const [selectedMeasureFilter, setSelectedMeasureFilter] = useState<number | 'all'>('all');

  // Interactive Recognition Review / Note Correction mode
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editableNotes, setEditableNotes] = useState<MusicNote[]>([]);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);

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

  const pageImages = useMemo(() => {
    if (score.pageImages && score.pageImages.length > 0) return score.pageImages;
    if (score.imageUrl) return [score.imageUrl];
    return [];
  }, [score.pageImages, score.imageUrl]);

  useEffect(() => {
    setTempo(score.tempo || 88);
    setActiveNoteIndex(null);
    setIsPlaying(false);
    setIsPaused(false);
    setActivePageIdx(0);
    setSelectedPageFilter('all');
    setSelectedSystemFilter('all');
    setSelectedMeasureFilter('all');
    audioEngine.stop();
  }, [score.id, selectedPartId]);


  useEffect(() => {
    setEditableNotes(activePart.notes.map((n) => ({ ...n })));
    setSelectedNote(activePart.notes[0] || null);
  }, [activePart]);

  useEffect(() => {
    return () => {
      audioEngine.stop();
    };
  }, []);

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

  // Available pages, systems, and measures for the active part
  const availablePages = useMemo(() => {
    const pSet = new Set<number>();
    for (let i = 1; i <= pageImages.length; i++) {
      pSet.add(i);
    }
    activePart.notes.forEach((n) => {
      pSet.add(getNotePage(n));
    });
    return Array.from(pSet).sort((a, b) => a - b);
  }, [activePart, pageImages.length]);

  const availableSystems = useMemo(() => {
    const sysSet = new Set<number>();
    activePart.notes.forEach((n) => {
      if (selectedPageFilter === 'all' || getNotePage(n) === selectedPageFilter) {
        sysSet.add(getNoteSystem(n));
      }
    });
    return Array.from(sysSet).sort((a, b) => a - b);
  }, [activePart, selectedPageFilter]);

  const availableMeasures = useMemo(() => {
    const mSet = new Set<number>();
    activePart.notes.forEach((n) => {
      if (selectedPageFilter !== 'all' && getNotePage(n) !== selectedPageFilter) return;
      if (selectedSystemFilter !== 'all' && getNoteSystem(n) !== selectedSystemFilter) return;
      mSet.add(n.measure);
    });
    return Array.from(mSet).sort((a, b) => a - b);
  }, [activePart, selectedPageFilter, selectedSystemFilter]);

  // Filtered notes based on user-selected Page, System, or Measure
  const displayedNotes = useMemo(() => {
    return activePart.notes.filter((n) => {
      if (selectedPageFilter !== 'all' && getNotePage(n) !== selectedPageFilter) {
        return false;
      }
      if (selectedSystemFilter !== 'all' && getNoteSystem(n) !== selectedSystemFilter) {
        return false;
      }
      if (selectedMeasureFilter !== 'all' && n.measure !== selectedMeasureFilter) {
        return false;
      }
      return true;
    });
  }, [activePart, selectedPageFilter, selectedSystemFilter, selectedMeasureFilter]);

  // Synchronized system/staff highlight on the original uploaded score image (1-indexed global system number)
  const highlightedSystemNumber = useMemo(() => {
    if (activeNoteIndex !== null && displayedNotes[activeNoteIndex]) {
      return getNoteSystem(displayedNotes[activeNoteIndex]);
    }
    if (selectedNote) {
      return getNoteSystem(selectedNote);
    }
    if (selectedSystemFilter !== 'all') {
      return selectedSystemFilter;
    }
    return null;
  }, [activeNoteIndex, displayedNotes, selectedNote, selectedSystemFilter]);

  const startPlaybackSequence = (startIndex = 0) => {
    setIsPlaying(true);
    setIsPaused(false);
    audioEngine.playMelodySequence(
      displayedNotes,
      tempo,
      (idx) => {
        setActiveNoteIndex(idx);
        if (idx !== null && displayedNotes[idx]) {
          const currentNote = displayedNotes[idx];
          setSelectedNote(currentNote);
          const pNum = getNotePage(currentNote);
          if (pNum - 1 !== activePageIdx && pNum - 1 < pageImages.length) {
            setActivePageIdx(Math.max(0, pNum - 1));
          }
        }
      },
      () => {
        setIsPlaying(false);
        setIsPaused(false);
        setActiveNoteIndex(null);
      },
      {
        voice,
        metronome: metronomeOn,
        loop: loopEnabled,
        startIndex,
      }
    );
  };

  const handlePlay = () => {
    startPlaybackSequence(0);
  };

  const handlePause = () => {
    audioEngine.pause();
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleResume = () => {
    audioEngine.resume();
    setIsPaused(false);
    setIsPlaying(true);
  };

  const handleRestart = () => {
    startPlaybackSequence(0);
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    setIsPaused(false);
    setActiveNoteIndex(null);
  };

  const handleToggleLoop = () => {
    const nextLoop = !loopEnabled;
    setLoopEnabled(nextLoop);
    audioEngine.setLoop(nextLoop);
  };

  const activeScopeSlug = useMemo(() => {
    const partsSlug: string[] = [];
    if (selectedPageFilter !== 'all') partsSlug.push(`page-${selectedPageFilter}`);
    if (selectedSystemFilter !== 'all') partsSlug.push(`system-${selectedSystemFilter}`);
    if (selectedMeasureFilter !== 'all') partsSlug.push(`measure-${selectedMeasureFilter}`);
    return partsSlug.length > 0 ? partsSlug.join('-') : 'full-song';
  }, [selectedPageFilter, selectedSystemFilter, selectedMeasureFilter]);


  const handleNoteClick = (note: MusicNote, index: number) => {
    setSelectedNote(note);
    setActiveNoteIndex(index);
    const pNum = getNotePage(note);
    if (pNum - 1 < pageImages.length) {
      setActivePageIdx(Math.max(0, pNum - 1));
    }
    if (!note.isRest && note.pitch !== 'REST' && note.frequency > 0) {
      const dur = audioEngine.getDurationSeconds(note.duration, tempo, note.audioType);
      audioEngine.playNote(note.frequency, dur, voice, note.chordFrequencies);
    }
  };

  const handleEditNoteField = (idx: number, field: keyof MusicNote, value: unknown) => {
    setEditableNotes((prev) => {
      const copy = [...prev];
      const target = { ...copy[idx], [field]: value };
      if (field === 'isRest') {
        if (value === true) {
          target.pitch = 'REST';
          target.solfa = 'Rest';
          target.frequency = 0;
        } else if (target.pitch === 'REST') {
          target.pitch = activePart.clef === 'bass' ? 'C3' : 'C4';
        }
      }
      copy[idx] = target;
      return copy;
    });
  };

  const handleAddNoteAfter = (idx: number) => {
    setEditableNotes((prev) => {
      const refNote = prev[idx] || {
        pitch: activePart.clef === 'bass' ? 'C3' : 'C4',
        duration: 1,
        solfa: 'Do',
        measure: 1,
        beat: 1,
        frequency: 261.63,
        clef: activePart.clef,
        system: 1,
        page: activePageIdx + 1,
      };
      const newNote: MusicNote = {
        ...refNote,
        isRest: false,
        pitch: refNote.isRest ? (activePart.clef === 'bass' ? 'C3' : 'C4') : refNote.pitch,
        confidence: 'high',
        confidenceReason: null,
      };
      const copy = [...prev];
      copy.splice(idx + 1, 0, newNote);
      return copy;
    });
  };

  const handleDeleteNoteAt = (idx: number) => {
    if (editableNotes.length <= 1) return;
    setEditableNotes((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleApplyCorrections = async () => {
    setIsRecalculating(true);
    setRecalcMessage(null);
    try {
      const response = await fetch(getApiUrl('/api/recalculate-score'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score,
          partId: activePart.id || activePart.partId || 'P1',
          updatedNotes: editableNotes,
          fifths: score.keySignature?.fifths,
        }),
      });
      const json = await response.json();
      if (!response.ok || json.success === false) {
        throw new Error(json.error || 'Failed to recalculate corrected notes');
      }
      const updatedData: ScoreAnalysis = json.data ? json.data : json;
      onScoreUpdated({
        ...updatedData,
        imageUrl: score.imageUrl,
        pageImages: score.pageImages,
      });
      setRecalcMessage('Score notes, Solfa syllables, rhythm validation, and SmolLM2 guidance updated!');
      setIsEditingNotes(false);
    } catch (err: unknown) {
      setRecalcMessage(err instanceof Error ? err.message : 'Failed to update score');
    } finally {
      setIsRecalculating(false);
    }
  };

  const uncertainMeasures = useMemo(() => {
    return (activePart.measures || score.measures || []).filter((m) => m.confidence !== 'high');
  }, [activePart.measures, score.measures]);

  const pageLevelErrors = useMemo(() => {
    return (score.sectionDiagnostics || []).filter(
      (d) => d.status === 'failed' || d.severity === 'error'
    );
  }, [score.sectionDiagnostics]);

  const summary = score.recognitionSummary;
  const keyLabel = score.keySignature?.key || 'C Major';
  const timeSigLabel = `${score.timeSignature?.numerator || 4}/${score.timeSignature?.denominator || 4}`;
  const totalPagesCount = Math.max(
    pageImages.length,
    summary?.totalPages || summary?.pageCount || 1
  );

  return (
    <div className="space-y-6">
      {/* Top Score Header & Multi-Part / Summary Bar */}
      <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-[#FDF3EB] text-[#B85D19] border border-[#F5DEC9]">
                {score.keySignature?.homeSolfa || 'Movable-Do Solfa'}
              </span>
              <span className="text-xs font-mono text-[#6A6258] bg-[#F3EFE6] px-2.5 py-1 rounded-md">
                Key: {keyLabel}
              </span>
              <span className="text-xs font-mono text-[#6A6258] bg-[#F3EFE6] px-2.5 py-1 rounded-md">
                Time: {timeSigLabel}
              </span>
              <span className="text-xs font-mono text-[#6A6258] bg-[#F3EFE6] px-2.5 py-1 rounded-md uppercase">
                Clef: {activePart.clef}
              </span>
              {summary && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md ${
                    summary.overallConfidence === 'high'
                      ? 'bg-[#EBF5EE] text-[#1F7A4C]'
                      : 'bg-[#FEF3C7] text-[#B45309]'
                  }`}
                >
                  {summary.overallConfidence === 'high' ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {totalPagesCount} {totalPagesCount === 1 ? 'Page' : 'Pages'} •{' '}
                  {summary.totalSystems ?? summary.systemCount ?? 1} Systems •{' '}
                  {summary.totalParts ?? summary.partCount ?? parts.length} Parts •{' '}
                  {summary.totalMeasures ?? summary.measureCount ?? availableMeasures.length} Measures
                </span>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-[#2A2622] mt-2">
              {score.title}
            </h2>
            {score.composer && (
              <p className="text-xs text-[#78716C] mt-0.5">
                {score.composer}
              </p>
            )}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Export MusicXML Button */}
            <button
              type="button"
              onClick={() => downloadMusicXml(score)}
              className="min-h-[44px] px-4 py-2.5 rounded-xl font-semibold text-xs bg-white hover:bg-[#F3EFE6] text-[#2A2622] border border-[#DED8CC] flex items-center gap-1.5 transition-all cursor-pointer"
              title="Download full multi-part MusicXML 4.0 file"
            >
              <Download className="w-3.5 h-3.5 text-[#B85D19]" />
              <span>Export MusicXML</span>
            </button>

            <button
              type="button"
              onClick={onStartPractice}
              className="min-h-[44px] px-5 py-2.5 rounded-xl font-semibold text-xs bg-[#1F7A4C] hover:bg-[#18633D] text-white flex items-center gap-2 transition-all cursor-pointer shadow-xs"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Open Sight-Singing Practice Coach</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>


        {/* Vocal Part Selector & Page / System / Measure Navigation Bar */}
        <div className="mt-5 pt-4 border-t border-[#E6E0D4] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#6A6258] flex items-center gap-1.5 mr-1">
              <Layers className="w-3.5 h-3.5 text-[#B85D19]" />
              Vocal Part:
            </span>
            {parts.map((part) => {
              const pid = part.id || part.partId || 'P1';
              const isSelected = pid === (activePart.id || activePart.partId);
              const sungCount = part.notes.filter((n) => !n.isRest && n.pitch !== 'REST').length;
              const restCount = part.notes.filter((n) => n.isRest || n.pitch === 'REST').length;
              return (
                <button
                  key={pid}
                  onClick={() => {
                    onSelectPart(pid);
                    setSelectedPageFilter('all');
                    setSelectedSystemFilter('all');
                    setSelectedMeasureFilter('all');
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-[#2A2622] text-white border-[#2A2622] shadow-xs'
                      : 'bg-white text-[#4A443C] border-[#DED8CC] hover:border-[#B85D19]'
                  }`}
                >
                  {part.name} ({part.clef === 'bass' ? 'Bass 𝄢' : 'Treble 𝄞'} • {sungCount} notes
                  {restCount > 0 ? `, ${restCount} rests` : ''})
                </button>
              );
            })}
          </div>

          {/* Page, System & Measure Jump Controls */}
          <div className="flex flex-wrap items-center gap-3">
            {availablePages.length > 1 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-[#6A6258]">Page:</label>
                <select
                  value={selectedPageFilter}
                  onChange={(e) => {
                    const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                    setSelectedPageFilter(val);
                    if (val !== 'all') {
                      setActivePageIdx(Math.max(0, val - 1));
                    }
                    setSelectedSystemFilter('all');
                    setSelectedMeasureFilter('all');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
                >
                  <option value="all">All Pages ({availablePages.length})</option>
                  {availablePages.map((pNum) => (
                    <option key={pNum} value={pNum}>
                      Page {pNum}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {availableSystems.length > 1 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-[#6A6258]">System:</label>
                <select
                  value={selectedSystemFilter}
                  onChange={(e) => {
                    const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                    setSelectedSystemFilter(val);
                    setSelectedMeasureFilter('all');
                    if (val !== 'all' && score.systemsMetadata) {
                      const matchingSys = score.systemsMetadata.find(
                        (s) => getSystemGlobalNumber(s) === val
                      );
                      const pNum = matchingSys?.page || matchingSys?.pageNumber;
                      if (pNum && pNum - 1 < pageImages.length) {
                        setActivePageIdx(pNum - 1);
                      }
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
                >
                  <option value="all">All Systems ({availableSystems.length})</option>
                  {availableSystems.map((sysNum) => (
                    <option key={sysNum} value={sysNum}>
                      System {sysNum}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-[#6A6258]">Measure:</label>
              <select
                value={selectedMeasureFilter}
                onChange={(e) => {
                  const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                  setSelectedMeasureFilter(val);
                  if (val !== 'all') {
                    const mNote = activePart.notes.find((n) => n.measure === val);
                    if (mNote) {
                      const pNum = getNotePage(mNote);
                      if (pNum - 1 < pageImages.length) {
                        setActivePageIdx(Math.max(0, pNum - 1));
                      }
                    }
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-[#DED8CC] text-xs font-semibold text-[#2A2622]"
              >
                <option value="all">All Measures ({availableMeasures.length})</option>
                {availableMeasures.map((mNum) => (
                  <option key={mNum} value={mNum}>
                    Measure {mNum}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Unified Practice Audio Player & MP3/WAV Exporter Bar */}
      <PracticeAudioBar
        title={score.title}
        partName={activePart.name}
        fullPartNotes={activePart.notes}
        sectionNotes={displayedNotes}
        sectionLabel={activeScopeSlug}
        tempo={tempo}
        onTempoChange={setTempo}
        voice={voice}
        onVoiceChange={setVoice}
        metronomeOn={metronomeOn}
        onMetronomeToggle={() => setMetronomeOn((m) => !m)}
        isPlaying={isPlaying}
        isPaused={isPaused}
        loopEnabled={loopEnabled}
        activeNoteIndex={activeNoteIndex}
        onPlay={handlePlay}
        onPause={handlePause}
        onResume={handleResume}
        onRestart={handleRestart}
        onStop={handleStop}
        onToggleLoop={handleToggleLoop}
      />


      {/* Section Diagnostics & Recognition Honesty Banner */}
      {((score.sectionDiagnostics && score.sectionDiagnostics.length > 0) ||
        uncertainMeasures.length > 0) && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#92400E]">
                Optical Recognition Review Notice (
                {pageLevelErrors.length > 0
                  ? `${pageLevelErrors.length} section issue(s) • `
                  : ''}
                {uncertainMeasures.length}{' '}
                {uncertainMeasures.length === 1 ? 'measure flagged' : 'measures flagged'})
              </h4>
              <p className="text-xs text-[#78350F] mt-1 leading-relaxed">
                ChoirMate AI never fabricates missing notes or silently omits unrecognized pages. Any page, system, or measure with recognition warnings or rhythmic discrepancies is listed below so you can verify it against your original score and edit notes directly.
              </p>

              {/* Explicit per-page / per-section diagnostics list */}
              {score.sectionDiagnostics && score.sectionDiagnostics.length > 0 && (
                <div className="mt-2 space-y-1">
                  {score.sectionDiagnostics.slice(0, 6).map((diag, dIdx) => (
                    <div
                      key={dIdx}
                      className="text-[11px] font-medium text-[#92400E] flex items-center gap-1.5"
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D97706]" />
                      <span>{diag.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {uncertainMeasures.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {uncertainMeasures.slice(0, 10).map((um) => (
                    <button
                      key={um.measureNumber}
                      onClick={() => setSelectedMeasureFilter(um.measureNumber)}
                      className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-white border border-[#FCD34D] text-[#92400E] hover:bg-[#FEF3C7] cursor-pointer"
                    >
                      m.{um.measureNumber}: {um.actualBeats}/{um.expectedBeats} beats
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setIsEditingNotes(!isEditingNotes)}
            className="px-3.5 py-2 rounded-xl bg-[#B45309] hover:bg-[#92400E] text-white text-xs font-semibold shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {isEditingNotes ? 'Close Note Editor' : 'Review & Correct Notes'}
          </button>
        </div>
      )}

      {/* Mobile View Switcher (Original Score vs Recognized Notes) + Desktop Side-by-Side Toggle */}
      {pageImages.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FDFBF7] border border-[#E6E0D4] rounded-xl px-4 py-2.5">
          {/* Mobile View Switcher */}
          <div className="flex lg:hidden items-center gap-1 bg-[#F3EFE6] p-1 rounded-lg border border-[#E6E0D4] w-full sm:w-auto justify-center">
            <button
              type="button"
              onClick={() => setMobileViewTab('both')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                mobileViewTab === 'both'
                  ? 'bg-white text-[#B85D19] shadow-xs'
                  : 'text-[#6A6258]'
              }`}
            >
              Both Views
            </button>
            <button
              type="button"
              onClick={() => setMobileViewTab('original')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                mobileViewTab === 'original'
                  ? 'bg-white text-[#B85D19] shadow-xs'
                  : 'text-[#6A6258]'
              }`}
            >
              Original Score
            </button>
            <button
              type="button"
              onClick={() => setMobileViewTab('recognized')}
              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${
                mobileViewTab === 'recognized'
                  ? 'bg-white text-[#B85D19] shadow-xs'
                  : 'text-[#6A6258]'
              }`}
            >
              Recognized Solfa
            </button>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-xs text-[#6A6258]">
            <FileText className="w-4 h-4 text-[#B85D19]" />
            <span>
              Original uploaded score is preserved alongside recognized notes &amp; Solfa syllables.
            </span>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={() => setSideBySideView(!sideBySideView)}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F3EFE6] hover:bg-[#E6E0D4] text-xs font-semibold text-[#2A2622] cursor-pointer"
            >
              <Columns className="w-3.5 h-3.5 text-[#B85D19]" />
              {sideBySideView ? 'Stacked Layout' : 'Side-by-Side Layout'}
            </button>
            <button
              type="button"
              onClick={() => setShowReconstructedStave(!showReconstructedStave)}
              className="text-xs font-semibold text-[#B85D19] hover:underline cursor-pointer"
            >
              {showReconstructedStave
                ? 'Hide Reconstructed Stave'
                : 'Show Reconstructed Stave'}
            </button>
          </div>
        </div>
      )}

      {/* Main Synchronized Score & Recognized Stave Container */}
      <div
        className={`grid grid-cols-1 gap-6 items-start ${
          pageImages.length > 0 && showReconstructedStave && sideBySideView
            ? 'lg:grid-cols-12'
            : ''
        }`}
      >
        {/* Original Uploaded PDF / Sheet Music Reference with Page Navigation & Zoom */}
        {pageImages.length > 0 && mobileViewTab !== 'recognized' && (
          <div
            className={`${
              showReconstructedStave && sideBySideView ? 'lg:col-span-6' : 'col-span-1'
            } bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-5 sm:p-6 shadow-sm`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-[#B85D19]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#2A2622]">
                  Original Score Reference (Page {activePageIdx + 1} of {pageImages.length})
                </h3>
              </div>

              {/* Page Navigation & Zoom Controls */}
              <div className="flex flex-wrap items-center gap-2">
                {pageImages.length > 1 && (
                  <div className="flex items-center gap-1 bg-[#F3EFE6] p-1 rounded-lg border border-[#E6E0D4]">
                    <button
                      type="button"
                      disabled={activePageIdx <= 0}
                      onClick={() => setActivePageIdx((p) => Math.max(0, p - 1))}
                      className="p-1 rounded hover:bg-white disabled:opacity-40 cursor-pointer"
                      title="Previous Page"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-mono font-semibold px-2 text-[#2A2622]">
                      Page {activePageIdx + 1} / {pageImages.length}
                    </span>
                    <button
                      type="button"
                      disabled={activePageIdx >= pageImages.length - 1}
                      onClick={() =>
                        setActivePageIdx((p) => Math.min(pageImages.length - 1, p + 1))
                      }
                      className="p-1 rounded hover:bg-white disabled:opacity-40 cursor-pointer"
                      title="Next Page"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Zoom Controls */}
                <div className="flex items-center gap-1 bg-[#F3EFE6] p-1 rounded-lg border border-[#E6E0D4]">
                  <button
                    type="button"
                    onClick={() => setZoomPercent((z) => Math.max(60, z - 20))}
                    className="p-1 rounded hover:bg-white text-[#2A2622] cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono font-semibold px-1.5 text-[#2A2622]">
                    {zoomPercent}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomPercent((z) => Math.min(220, z + 20))}
                    className="p-1 rounded hover:bg-white text-[#2A2622] cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  {zoomPercent !== 100 && (
                    <button
                      type="button"
                      onClick={() => setZoomPercent(100)}
                      className="p-1 rounded hover:bg-white text-[#6A6258] cursor-pointer"
                      title="Reset Zoom"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Page Thumbnail Strip when Multi-Page PDF is loaded */}
            {pageImages.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-3 border-b border-[#E6E0D4]">
                {pageImages.map((imgSrc, pIdx) => {
                  const pNum = pIdx + 1;
                  const isCurrent = activePageIdx === pIdx;
                  const failedThisPage = (summary?.failedPages || []).includes(pNum);
                  return (
                    <button
                      key={pNum}
                      type="button"
                      onClick={() => setActivePageIdx(pIdx)}
                      className={`shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                        isCurrent
                          ? 'bg-[#2A2622] text-white border-[#2A2622]'
                          : failedThisPage
                          ? 'bg-[#FDF2F2] text-[#991B1B] border-[#F5C2C7]'
                          : 'bg-white text-[#4A443C] border-[#DED8CC] hover:border-[#B85D19]'
                      }`}
                    >
                      <img
                        src={imgSrc}
                        alt={`Thumb p.${pNum}`}
                        className="w-6 h-8 object-cover rounded border border-[#E6E0D4] bg-white"
                      />
                      <span>Page {pNum}</span>
                      {failedThisPage && <AlertTriangle className="w-3 h-3 text-[#B91C1C]" />}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="relative bg-white border border-[#E6E0D4] rounded-xl p-3 overflow-auto max-h-[680px]">
              <div
                style={{ width: `${zoomPercent}%` }}
                className="relative mx-auto transition-all origin-top-left"
              >
                <img
                  src={pageImages[activePageIdx] || pageImages[0]}
                  alt={`Original uploaded sheet music page ${activePageIdx + 1}`}
                  className="w-full h-auto block rounded-lg select-none"
                />

                {/* Synchronized System & Staff Overlay Boxes on the Original Image */}
                {score.systemsMetadata &&
                  score.systemsMetadata
                    .filter((sys) => (sys.page || sys.pageNumber || 1) === activePageIdx + 1)
                    .map((sys) => {
                      const sysNum = getSystemGlobalNumber(sys);
                      const isSystemActive = highlightedSystemNumber === sysNum;
                      const partStaffZeroIdx = Math.max(0, (activePart.staffIndex || 1) - 1);
                      const activeStaffMeta = sys.staves?.[partStaffZeroIdx];
                      return (
                        <React.Fragment key={sysNum}>
                          <div
                            onClick={() => {
                              setSelectedSystemFilter(
                                selectedSystemFilter === sysNum ? 'all' : sysNum
                              );
                            }}
                            style={{
                              left: `${sys.bbox.x * 100}%`,
                              top: `${sys.bbox.y * 100}%`,
                              width: `${sys.bbox.width * 100}%`,
                              height: `${sys.bbox.height * 100}%`,
                            }}
                            className={`absolute rounded-md transition-all cursor-pointer ${
                              isSystemActive
                                ? 'border-2 border-[#B85D19] bg-[#B85D19]/10 shadow-xs'
                                : 'border border-[#B85D19]/35 hover:border-[#B85D19] hover:bg-[#B85D19]/5'
                            }`}
                            title={`Click to focus on System ${sysNum} (${sys.staffCount} staves)`}
                          >
                            <span
                              className={`absolute -top-5 left-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                isSystemActive
                                  ? 'bg-[#B85D19] text-white'
                                  : 'bg-[#2A2622]/80 text-white'
                              }`}
                            >
                              System {sysNum}
                            </span>
                          </div>

                          {isSystemActive && activeStaffMeta && (
                            <div
                              style={{
                                left: `${activeStaffMeta.bbox.x * 100}%`,
                                top: `${activeStaffMeta.bbox.y * 100}%`,
                                width: `${activeStaffMeta.bbox.width * 100}%`,
                                height: `${activeStaffMeta.bbox.height * 100}%`,
                              }}
                              className="absolute border-2 border-[#1F7A4C] bg-[#1F7A4C]/12 rounded pointer-events-none"
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6A6258] px-2">
                <span>
                  Click any detected <strong>System box</strong> on the original score to filter that system, or click any note to jump to its page and staff.
                </span>
                <span className="font-mono text-[11px] text-[#78716C]">
                  Original document preserved unaltered
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Optional Reconstructed Interactive Notation Stave */}
        {showReconstructedStave && mobileViewTab !== 'original' && (
          <div
            className={`${
              pageImages.length > 0 && sideBySideView ? 'lg:col-span-6' : 'col-span-1'
            } bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-5 sm:p-6 shadow-sm`}
          >
            <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
              <div className="flex items-center gap-2">
                <Music2 className="w-4 h-4 text-[#B85D19]" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#2A2622]">
                  Reconstructed Interactive Stave — {activePart.name} (
                  {selectedPageFilter === 'all' ? 'All Pages' : `Page ${selectedPageFilter}`}
                  {selectedSystemFilter === 'all' ? '' : `, System ${selectedSystemFilter}`}
                  {selectedMeasureFilter === 'all' ? '' : `, Measure ${selectedMeasureFilter}`})
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsEditingNotes(!isEditingNotes)}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#F3EFE6] hover:bg-[#E6E0D4] text-xs font-semibold text-[#2A2622] cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#B85D19]" />
                  {isEditingNotes ? 'Hide Editor' : 'Edit / Fix Notes'}
                </button>
              </div>
            </div>

            <div className="bg-white border border-[#EAE4D8] rounded-xl p-4">
              <InteractiveStave
                notes={displayedNotes}
                activeNoteIndex={activeNoteIndex}
                onNoteClick={handleNoteClick}
                keySignature={keyLabel}
                timeSignature={timeSigLabel}
                clef={activePart.clef}
              />
            </div>

            {/* Selected Note Inspector */}
            {selectedNote && (
              <div className="mt-4 p-4 bg-[#F6F2EA] rounded-xl border border-[#E6E0D4] flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#B85D19] text-white flex flex-col items-center justify-center font-serif font-bold">
                    <span className="text-lg leading-none">
                      {selectedNote.isRest ? 'Rest' : selectedNote.solfa}
                    </span>
                    <span className="text-[10px] font-mono opacity-85 mt-0.5">
                      {selectedNote.pitch}
                    </span>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[#2A2622]">
                        {selectedNote.isRest
                          ? `Musical Rest (${selectedNote.durationName || selectedNote.audioType || selectedNote.duration})`
                          : `Solfa Syllable: "${selectedNote.solfa}"`}
                      </span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-white border border-[#DED8CC] text-[#6A6258]">
                        Page {getNotePage(selectedNote)} • System {getNoteSystem(selectedNote)} • Measure {selectedNote.measure}
                      </span>
                      {selectedNote.confidence && selectedNote.confidence !== 'high' && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#FEF3C7] text-[#B45309]">
                          Review suggested ({selectedNote.confidenceReason || selectedNote.uncertaintyReason || 'Check rhythm against original'})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6A6258] mt-1">
                      {selectedNote.singingTip ||
                        (selectedNote.isRest
                          ? 'Hold silence and prepare for the next phrase.'
                          : `Pitch: ${selectedNote.pitch} (${selectedNote.frequency} Hz) • ${selectedNote.durationName || `${selectedNote.duration} beat(s)`}`)}
                      {selectedNote.chordPitches && selectedNote.chordPitches.length > 0
                        ? ` • Harmony Notes: ${selectedNote.chordPitches.join(', ')}`
                        : ''}
                    </p>
                  </div>
                </div>

                {!selectedNote.isRest && selectedNote.frequency > 0 && (
                  <button
                    onClick={() =>
                      audioEngine.playNote(
                        selectedNote.frequency,
                        audioEngine.getDurationSeconds(selectedNote.duration, tempo, selectedNote.audioType),
                        voice,
                        selectedNote.chordFrequencies
                      )
                    }
                    className="px-3.5 py-2 rounded-lg bg-white hover:bg-[#FDF6EE] border border-[#DED8CC] text-xs font-semibold text-[#2A2622] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-[#B85D19]" />
                    Hear Reference Tone
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Interactive Note & Measure Review / Correction Panel */}
      {isEditingNotes && (
        <div className="bg-[#FDFBF7] border-2 border-[#B85D19] rounded-2xl p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-serif font-bold text-[#2A2622] flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-[#B85D19]" />
                Interactive Recognition Review &amp; Note Correction ({activePart.name})
              </h3>
              <p className="text-xs text-[#6A6258] mt-0.5">
                Correct any misread note pitch, accidental, rest, or rhythmic value below, then click &ldquo;Apply Corrections &amp; Regenerate Lesson&rdquo; to recompute Solfa syllables and SmolLM2 vocal coaching.
              </p>
            </div>
            <button
              onClick={handleApplyCorrections}
              disabled={isRecalculating}
              className="px-4 py-2.5 rounded-xl bg-[#B85D19] hover:bg-[#9F4E12] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
              {isRecalculating ? 'Recomputing Solfa & Coaching...' : 'Apply Corrections & Regenerate Lesson'}
            </button>
          </div>

          {recalcMessage && (
            <div className="mb-4 p-3 rounded-xl bg-[#EBF5EE] border border-[#C5E3CE] text-xs font-semibold text-[#1F7A4C]">
              {recalcMessage}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto border border-[#E6E0D4] rounded-xl bg-white">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-[#F3EFE6] text-[#6A6258] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">#</th>
                  <th className="py-2.5 px-3 font-semibold">Page</th>
                  <th className="py-2.5 px-3 font-semibold">Measure</th>
                  <th className="py-2.5 px-3 font-semibold">Event Type</th>
                  <th className="py-2.5 px-3 font-semibold">Pitch (Step / Acc / Oct)</th>
                  <th className="py-2.5 px-3 font-semibold">Duration (Beats)</th>
                  <th className="py-2.5 px-3 font-semibold">Current Solfa</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAE4D8]">
                {editableNotes.map((n, idx) => {
                  const isRest = Boolean(n.isRest || n.pitch === 'REST');
                  const match = (n.pitch || 'C4').match(/^([A-G])([#b]?)(\d)$/);
                  const step = match ? match[1] : 'C';
                  const acc = match ? match[2] : '';
                  const oct = match ? match[3] : '4';
                  const numericBeats = typeof n.duration === 'number' ? n.duration : 1;

                  return (
                    <tr
                      key={idx}
                      className={
                        n.confidence && n.confidence !== 'high' ? 'bg-[#FFFBEB]' : 'hover:bg-[#FAF8F5]'
                      }
                    >
                      <td className="py-2 px-3 font-mono text-[#78716C]">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono text-[#6A6258]">p.{getNotePage(n)}</td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min={1}
                          value={n.measure}
                          onChange={(e) =>
                            handleEditNoteField(idx, 'measure', Math.max(1, Number(e.target.value)))
                          }
                          className="w-16 px-2 py-1 border border-[#DED8CC] rounded font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={isRest ? 'rest' : 'note'}
                          onChange={(e) => handleEditNoteField(idx, 'isRest', e.target.value === 'rest')}
                          className="px-2 py-1 border border-[#DED8CC] rounded text-xs"
                        >
                          <option value="note">Sung Note</option>
                          <option value="rest">Rest</option>
                        </select>
                      </td>
                      <td className="py-2 px-3">
                        {isRest ? (
                          <span className="font-mono text-[#78716C]">REST</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <select
                              value={step}
                              onChange={(e) =>
                                handleEditNoteField(idx, 'pitch', `${e.target.value}${acc}${oct}`)
                              }
                              className="px-1.5 py-1 border border-[#DED8CC] rounded font-mono"
                            >
                              {VALID_PITCH_STEPS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <select
                              value={acc}
                              onChange={(e) =>
                                handleEditNoteField(idx, 'pitch', `${step}${e.target.value}${oct}`)
                              }
                              className="px-1.5 py-1 border border-[#DED8CC] rounded font-mono"
                            >
                              {VALID_ACCIDENTALS.map((a) => (
                                <option key={a} value={a}>
                                  {a === '' ? '♮' : a === '#' ? '♯' : '♭'}
                                </option>
                              ))}
                            </select>
                            <select
                              value={oct}
                              onChange={(e) =>
                                handleEditNoteField(idx, 'pitch', `${step}${acc}${e.target.value}`)
                              }
                              className="px-1.5 py-1 border border-[#DED8CC] rounded font-mono"
                            >
                              {VALID_OCTAVES.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={numericBeats}
                          onChange={(e) => handleEditNoteField(idx, 'duration', Number(e.target.value))}
                          className="px-2 py-1 border border-[#DED8CC] rounded text-xs"
                        >
                          {VALID_DURATIONS.map((d) => (
                            <option key={d.beats} value={d.beats}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 font-bold text-[#B85D19]">
                        {isRest ? 'Rest' : n.solfa}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleAddNoteAfter(idx)}
                            className="p-1 rounded hover:bg-[#F3EFE6] text-[#1F7A4C]"
                            title="Insert note after this event"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteNoteAt(idx)}
                            className="p-1 rounded hover:bg-[#FDF2F2] text-[#B91C1C]"
                            title="Delete this event"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bottom Coaching Grid: Solfa Breakdown & Choir Director Tips */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-[#B85D19]" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-[#2A2622]">
              Solfa &amp; Melodic Breakdown (Validated MusicXML + SmolLM2)
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-white border border-[#EAE4D8]">
              <span className="font-bold text-[#B85D19] uppercase tracking-wider block mb-1">
                Piece Essence
              </span>
              <p className="text-[#4A443C] leading-relaxed">
                {score.simpleExplanation?.essence}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-white border border-[#EAE4D8]">
              <span className="font-bold text-[#B85D19] uppercase tracking-wider block mb-1">
                Vocal Range &amp; Shape
              </span>
              <p className="text-[#4A443C] leading-relaxed">
                {score.simpleExplanation?.range} {score.simpleExplanation?.melodicShape}
              </p>
            </div>
          </div>

          {/* Measure-by-Measure Solfa Chips */}
          <div className="pt-4 border-t border-[#EAE4D8]">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#78716C] mb-3">
              Complete Syllables Sequence ({activePart.name})
            </h4>
            <div className="flex flex-wrap gap-2">
              {displayedNotes.map((note, idx) => {
                const isRest = Boolean(note.isRest || note.pitch === 'REST');
                return (
                  <button
                    key={idx}
                    onClick={() => handleNoteClick(note, idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                      activeNoteIndex === idx
                        ? 'bg-[#B85D19] text-white border-[#B85D19] shadow-xs'
                        : isRest
                        ? 'bg-[#F3EFE6] text-[#78716C] border-[#E6E0D4]'
                        : 'bg-white text-[#2A2622] border-[#E6E0D4] hover:border-[#B85D19]'
                    }`}
                  >
                    <span className="font-bold">{isRest ? 'Rest' : note.solfa}</span>
                    <span className="text-[10px] font-mono opacity-75 ml-1">
                      ({isRest ? `m.${note.measure}` : note.pitch})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Vocal Warm-up & Rhythm Coaching */}
        <div className="space-y-4">
          <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[#B85D19]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#2A2622]">
                Choir Director Vocal Tip
              </h4>
            </div>
            <p className="text-xs text-[#57534E] leading-relaxed">
              {score.simpleExplanation?.choralTip}
            </p>
          </div>

          <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-[#1F7A4C]" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-[#2A2622]">
                Rhythm &amp; Counting Guide
              </h4>
            </div>
            <p className="text-xs font-mono text-[#2A2622] mb-1.5">
              {score.rhythmBreakdown?.countingGuide}
            </p>
            <p className="text-xs text-[#57534E] leading-relaxed">
              {score.rhythmBreakdown?.advice}
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Voice & Text Music Q&A (AssemblyAI Speech-to-Text + Local SmolLM2) */}
      <VoiceQuestionPanel
        score={score}
        activePart={activePart}
        displayedNotes={displayedNotes}
      />
    </div>
  );
};

