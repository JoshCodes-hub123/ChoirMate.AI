import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  ArrowRight,
  Play,
  AudioLines,
  BookOpen,
  Mic,
  CheckCircle2,
  Sparkles,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Volume2,
} from 'lucide-react';
import { ScoreAnalysis } from '../types/music';
import { SAMPLE_SCORES } from '../data/sampleScores';

interface HomeScreenProps {
  onLearnNewScore: () => void;
  onSelectSample: (score: ScoreAnalysis, targetScreen?: 'results' | 'voice-studio' | 'practice') => void;
}

const PREVIEW_NOTES = [
  { pitch: 'C4', solfa: 'Do', beat: 'Beat 1', duration: 'Quarter (1 beat)', freq: 261.63, tip: 'Grounded tonic center — breathe low and open your throat.' },
  { pitch: 'E4', solfa: 'Mi', beat: 'Beat 2', duration: 'Quarter (1 beat)', freq: 329.63, tip: 'Major third — keep vowel bright so the chord doesn’t sag.' },
  { pitch: 'G4', solfa: 'Sol', beat: 'Beat 3', duration: 'Quarter (1 beat)', freq: 392.0, tip: 'Dominant fifth — resonant ring in the mask.' },
  { pitch: 'C5', solfa: 'Do’', beat: 'Beat 4', duration: 'Half (2 beats)', freq: 523.25, tip: 'Octave tonic — lift soft palate and spin the air.' },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onLearnNewScore,
  onSelectSample,
}) => {
  const [activeNoteIdx, setActiveNoteIdx] = useState(0);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const playNoteTone = (freq: number, durationSec = 0.48) => {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durationSec + 0.03);
      osc2.stop(now + durationSec + 0.03);
    } catch {
      // Ignore Web Audio gesture restriction
    }
  };

  const handlePlayPhrase = () => {
    if (isPlayingPreview) return;
    setIsPlayingPreview(true);
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];

    PREVIEW_NOTES.forEach((note, idx) => {
      const tid = window.setTimeout(() => {
        setActiveNoteIdx(idx);
        playNoteTone(note.freq, idx === 3 ? 0.65 : 0.45);
      }, idx * 520);
      timersRef.current.push(tid);
    });

    const endTid = window.setTimeout(() => {
      setIsPlayingPreview(false);
    }, PREVIEW_NOTES.length * 520 + 200);
    timersRef.current.push(endTid);
  };

  const primaryDemoScore = SAMPLE_SCORES[0];

  return (
    <div className="w-full text-[#16221A] pb-20">
      {/* HERO SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-8 sm:pt-14 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          {/* Left Column: Editorial Value Proposition */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#9E7B35] border-b border-[#D8CBB3] pb-1.5">
              <span>AI Choral Score Analysis & SATB Rehearsal Studio</span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.5rem] font-bold text-[#143826] leading-[1.08] tracking-tight">
              Turn any sheet of music into something you can practice.
            </h1>

            <p className="text-base sm:text-lg text-[#45544B] max-w-2xl leading-relaxed">
              Upload your score, understand the notes, isolate your vocal part, and rehearse with confidence.
            </p>

            {/* Primary & Secondary CTAs */}
            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <button
                type="button"
                onClick={onLearnNewScore}
                className="px-6 py-3.5 rounded-xl bg-[#143826] hover:bg-[#1B4B33] text-white font-semibold text-sm sm:text-base transition-all flex items-center gap-2.5 shadow-md cursor-pointer active:scale-[0.99]"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Upload Sheet Music</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>

              {primaryDemoScore && (
                <button
                  type="button"
                  onClick={() => onSelectSample(primaryDemoScore, 'results')}
                  className="px-6 py-3.5 rounded-xl border-2 border-[#143826]/30 bg-white/80 hover:bg-white hover:border-[#143826] text-[#143826] font-semibold text-sm sm:text-base transition-all flex items-center gap-2 cursor-pointer active:scale-[0.99]"
                >
                  <Sparkles className="w-4 h-4 text-[#9E7B35] shrink-0" />
                  <span>Try a Demo</span>
                </button>
              )}
            </div>

            {/* Supported Formats & Guarantee */}
            <div className="pt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-[#E4DCCB] text-xs text-[#4F5F56]">
              <div className="flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-[#143826] shrink-0" />
                <span>
                  <strong className="text-[#16221A]">MusicXML (.xml)</strong> multi-part SATB
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#143826] shrink-0" />
                <span>
                  <strong className="text-[#16221A]">Sheet Images</strong> PNG, JPG, WebP
                </span>
              </div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#143826] shrink-0" />
                <span>
                  <strong className="text-[#16221A]">Multi-Page PDF</strong> score documents
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Notation-to-Solfa & SATB Studio Preview */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-2xl border border-[#DFD6C3] shadow-xl overflow-hidden">
              {/* Top Studio Header Bar */}
              <div className="bg-[#143826] text-white px-5 py-3.5 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase tracking-widest text-[#D6B872] font-semibold block">
                    Interactive Score Translator
                  </span>
                  <h2 className="font-serif text-base font-bold">
                    Key of C Major • 4/4 Time • Treble Staff
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handlePlayPhrase}
                  disabled={isPlayingPreview}
                  className="px-3.5 py-1.5 rounded-lg bg-[#9E7B35] hover:bg-[#B28C3F] disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isPlayingPreview ? 'Playing...' : 'Hear Phrase'}</span>
                </button>
              </div>

              {/* Interactive 5-Line Staff Visualization */}
              <div className="p-5 bg-[#FCF9F3] border-b border-[#EAE2D2]">
                <svg
                  viewBox="0 0 420 130"
                  className="w-full h-32 select-none"
                  role="img"
                  aria-label="Interactive musical staff showing C4, E4, G4, and C5 with solfa syllables"
                >
                  {/* 5 Staff Lines (y = 30, 45, 60, 75, 90) */}
                  {[30, 45, 60, 75, 90].map((y) => (
                    <line
                      key={y}
                      x1="20"
                      y1={y}
                      x2="400"
                      y2={y}
                      stroke="#C9BEA9"
                      strokeWidth="1.4"
                    />
                  ))}

                  {/* Treble Clef & Time Signature */}
                  <text x="28" y="82" fontSize="54" fill="#143826" fontFamily="serif">
                    𝄞
                  </text>
                  <text x="68" y="57" fontSize="20" fontWeight="bold" fill="#143826" fontFamily="serif">
                    4
                  </text>
                  <text x="68" y="85" fontSize="20" fontWeight="bold" fill="#143826" fontFamily="serif">
                    4
                  </text>

                  {/* Ledger line for C4 (y = 105) */}
                  <line x1="112" y1="105" x2="144" y2="105" stroke="#143826" strokeWidth="1.8" />

                  {/* 4 Interactive Noteheads */}
                  {[
                    { x: 128, y: 105, stemUp: true }, // C4
                    { x: 202, y: 90, stemUp: true },  // E4
                    { x: 276, y: 75, stemUp: true },  // G4
                    { x: 350, y: 52.5, stemUp: false }, // C5
                  ].map((pos, idx) => {
                    const note = PREVIEW_NOTES[idx];
                    const isSelected = activeNoteIdx === idx;
                    return (
                      <g
                        key={note.pitch}
                        onClick={() => {
                          setActiveNoteIdx(idx);
                          playNoteTone(note.freq);
                        }}
                        className="cursor-pointer"
                      >
                        {isSelected && (
                          <rect
                            x={pos.x - 26}
                            y="12"
                            width="52"
                            height="108"
                            rx="8"
                            fill="#143826"
                            fillOpacity="0.08"
                            stroke="#9E7B35"
                            strokeWidth="1.2"
                          />
                        )}
                        {/* Stem */}
                        <line
                          x1={pos.stemUp ? pos.x + 8 : pos.x - 8}
                          y1={pos.y}
                          x2={pos.stemUp ? pos.x + 8 : pos.x - 8}
                          y2={pos.stemUp ? pos.y - 36 : pos.y + 36}
                          stroke={isSelected ? '#143826' : '#32443A'}
                          strokeWidth="2.2"
                        />
                        {/* Notehead */}
                        <ellipse
                          cx={pos.x}
                          cy={pos.y}
                          rx="9.5"
                          ry="7"
                          transform={`rotate(-18 ${pos.x} ${pos.y})`}
                          fill={isSelected ? '#9E7B35' : '#143826'}
                        />
                        {/* Solfa Label Below */}
                        <text
                          x={pos.x}
                          y="124"
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight="bold"
                          fill={isSelected ? '#9E7B35' : '#143826'}
                        >
                          {note.solfa} ({note.pitch})
                        </text>
                      </g>
                    );
                  })}
                </svg>

                <div className="grid grid-cols-4 gap-2 mt-2">
                  {PREVIEW_NOTES.map((note, idx) => (
                    <button
                      key={note.pitch}
                      type="button"
                      onClick={() => {
                        setActiveNoteIdx(idx);
                        playNoteTone(note.freq);
                      }}
                      className={`py-2 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                        activeNoteIdx === idx
                          ? 'bg-[#143826] text-white border-[#143826]'
                          : 'bg-white text-[#16221A] border-[#E2D9C5] hover:border-[#143826]/40'
                      }`}
                    >
                      <span className="text-xs font-bold block">{note.solfa}</span>
                      <span className="text-[10px] opacity-80 font-mono block">{note.pitch}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Note Breakdown Detail */}
              <div className="p-5 space-y-3 bg-white">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#143826] flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#9E7B35]" />
                    Selected Note: {PREVIEW_NOTES[activeNoteIdx].pitch} ({PREVIEW_NOTES[activeNoteIdx].solfa})
                  </span>
                  <span className="font-mono text-[#5D6D63]">
                    {PREVIEW_NOTES[activeNoteIdx].freq} Hz • {PREVIEW_NOTES[activeNoteIdx].duration}
                  </span>
                </div>
                <p className="text-xs text-[#45544B] bg-[#F7F3EA] p-3 rounded-xl border border-[#E6DEC8]">
                  <strong className="text-[#143826]">Vocal Coaching Tip:</strong>{' '}
                  {PREVIEW_NOTES[activeNoteIdx].tip}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4-STEP WORKFLOW SECTION */}
      <section className="bg-[#F3EDE1] border-y border-[#E2D9C5] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12">
          <div className="max-w-2xl mb-10">
            <span className="text-xs font-bold uppercase tracking-widest text-[#9E7B35]">
              How ChoirMate AI Works
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-[#143826] mt-1">
              From raw sheet music to confident rehearsal in four steps.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: '01',
                title: 'Upload',
                icon: Upload,
                desc: 'Upload your own MusicXML (.musicxml / .xml), sheet music image (PNG, JPG, WebP), or multi-page PDF score.',
              },
              {
                step: '02',
                title: 'Analyze',
                icon: Sparkles,
                desc: 'Our Python music-processing engine extracts real pitches, durations, key & time signatures, and vocal staves.',
              },
              {
                step: '03',
                title: 'Understand',
                icon: BookOpen,
                desc: 'See movable-Do solfa syllables, measure beat counts, interval leaps, and plain-English singing explanations.',
              },
              {
                step: '04',
                title: 'Practice',
                icon: AudioLines,
                desc: 'Isolate Soprano, Alto, Tenor, or Bass in the SATB Voice Studio, download MP3/WAV practice tracks, and check live pitch.',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="bg-[#FAF5ED] rounded-2xl p-6 border border-[#DFD6C3] flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-mono text-xs font-bold text-[#9E7B35]">
                        STEP {item.step}
                      </span>
                      <div className="w-9 h-9 rounded-xl bg-[#143826]/10 text-[#143826] flex items-center justify-center">
                        <Icon className="w-4 h-4" />
                      </div>
                    </div>
                    <h3 className="font-serif text-xl font-bold text-[#143826] mb-2">
                      {item.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-[#4D5D53] leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* EXPLICITLY LABELED DEMO SCORES SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-[#9E7B35]">
              Explicitly Labeled Reference Library
            </span>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#143826] mt-1">
              Explore Built-In Demo Scores
            </h2>
            <p className="text-sm text-[#4F5F56] mt-1 max-w-2xl">
              Don’t have a score file handy right now? Choose one of our pre-analyzed demonstration scores below to test the SATB Voice Studio, Solfa Breakdown, and Practice Coach.
            </p>
          </div>
          <button
            type="button"
            onClick={onLearnNewScore}
            className="self-start md:self-auto px-4 py-2.5 rounded-xl bg-[#143826] text-white text-xs font-semibold flex items-center gap-2 hover:bg-[#1B4B33] cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Your Own Score Instead</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SAMPLE_SCORES.map((demo) => {
            const partNames = (demo.parts || []).map((p) => p.name).join(' • ') || 'Lead Vocal';
            return (
              <div
                key={demo.id}
                className="bg-white rounded-2xl border border-[#DFD6C3] p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B6914] bg-[#FDF6E4] border border-[#E8CF8C] px-2.5 py-0.5 rounded-md">
                      Demo Score
                    </span>
                    <span className="font-mono text-xs text-[#5D6D63]">
                      {demo.keySignature.key} • {demo.timeSignature.numerator}/{demo.timeSignature.denominator}
                    </span>
                  </div>

                  <h3 className="font-serif text-xl font-bold text-[#143826]">{demo.title}</h3>
                  <p className="text-xs text-[#637269] mt-0.5">{demo.composer}</p>

                  <p className="text-xs text-[#45544B] mt-3 line-clamp-2 leading-relaxed">
                    {demo.simpleExplanation.essence}
                  </p>

                  <div className="mt-4 pt-3 border-t border-[#EFE8DA] text-[11px] text-[#58685E] space-y-1">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#143826] shrink-0" />
                      <span>Parts: {partNames}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#143826] shrink-0" />
                      <span>Range: {demo.simpleExplanation.range} • {demo.tempo} BPM</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-[#EFE8DA] grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectSample(demo, 'results')}
                    className="py-2 px-2 rounded-lg bg-[#143826] hover:bg-[#1B4B33] text-white text-[11px] font-semibold text-center transition-colors cursor-pointer"
                  >
                    Breakdown
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSample(demo, 'voice-studio')}
                    className="py-2 px-2 rounded-lg border border-[#143826]/30 hover:bg-[#143826]/5 text-[#143826] text-[11px] font-semibold text-center transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <AudioLines className="w-3 h-3 shrink-0" />
                    <span>SATB</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSample(demo, 'practice')}
                    className="py-2 px-2 rounded-lg border border-[#143826]/30 hover:bg-[#143826]/5 text-[#143826] text-[11px] font-semibold text-center transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Mic className="w-3 h-3 shrink-0" />
                    <span>Practice</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
