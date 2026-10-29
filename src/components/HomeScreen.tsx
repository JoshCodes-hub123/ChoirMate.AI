import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  ArrowRight,
  Play,
  Download,
  FileText,
  Volume2,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { ScoreAnalysis } from '../types/music';
import { SAMPLE_SCORES } from '../data/sampleScores';

interface HomeScreenProps {
  onLearnNewScore: () => void;
  onSelectSample: (score: ScoreAnalysis) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onLearnNewScore,
  onSelectSample,
}) => {
  // Interactive Hero Melody State
  const [isPlayingMelody, setIsPlayingMelody] = useState(false);
  const [activeNoteIndex, setActiveNoteIndex] = useState(1); // Default to note 1 (Mi) to match reference image
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playTimeoutRefs = useRef<number[]>([]);

  // Cleanup audio timers on unmount
  useEffect(() => {
    return () => {
      playTimeoutRefs.current.forEach((id) => window.clearTimeout(id));
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const playHeroMelody = () => {
    if (isPlayingMelody) return;
    setIsPlayingMelody(true);

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

      // Melody notes: Do (C4), Mi (E4), Sol (G4), Do (C5)
      const melody = [
        { freq: 261.63, name: 'Do', noteIndex: 0 },
        { freq: 329.63, name: 'Mi', noteIndex: 1 },
        { freq: 392.00, name: 'Sol', noteIndex: 2 },
        { freq: 523.25, name: "Do'", noteIndex: 3 },
      ];

      playTimeoutRefs.current.forEach((id) => window.clearTimeout(id));
      playTimeoutRefs.current = [];

      melody.forEach((item, index) => {
        const timerId = window.setTimeout(() => {
          setActiveNoteIndex(item.noteIndex);

          // Synthesize warm choral sine-triangle tone
          const now = ctx.currentTime;
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1600, now);

          osc1.type = 'triangle';
          osc1.frequency.setValueAtTime(item.freq, now);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(item.freq * 2, now); // soft octave overtone

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.2, now + 0.04);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

          osc1.connect(filter);
          osc2.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);

          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 0.5);
          osc2.stop(now + 0.5);

          // If last note, reset back to reference note state (Mi) after settling
          if (index === melody.length - 1) {
            const endTimer = window.setTimeout(() => {
              setActiveNoteIndex(1);
              setIsPlayingMelody(false);
            }, 600);
            playTimeoutRefs.current.push(endTimer);
          }
        }, index * 450);

        playTimeoutRefs.current.push(timerId);
      });
    } catch {
      setIsPlayingMelody(false);
      setActiveNoteIndex(1);
    }
  };

  return (
    <div className="space-y-20 pb-16">
      {/* ────────────────────────────────────────────────────────────
          1. EXACT HERO SECTION RECREATION (Matching Reference Image)
         ──────────────────────────────────────────────────────────── */}
      <section className="relative pt-2 sm:pt-6 lg:pt-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Left Column: Typography, Eyebrow & Actions */}
          <div className="lg:col-span-6 space-y-7 sm:space-y-8 pr-0 lg:pr-2">
            {/* Eyebrow: Warm ochre dash + tracked uppercase */}
            <div className="flex items-center gap-3">
              <span className="w-8 h-[2px] bg-[#9E7B35] rounded-full inline-block" />
              <span className="text-[11px] sm:text-xs font-semibold tracking-[0.24em] text-[#9E7B35] uppercase">
                MEET YOUR NEW MUSIC COMPANION
              </span>
            </div>

            {/* Main Headline: Bookish Serif Display */}
            <h1 className="font-serif text-[2.75rem] sm:text-[3.65rem] lg:text-[4.15rem] font-medium leading-[1.08] tracking-tight text-[#16221A] text-balance">
              Sing a song you’ve <br className="hidden sm:inline" />
              never sung before. <br className="hidden sm:inline" />
              Understand every note.
            </h1>

            {/* Subtitle Description */}
            <p className="text-base sm:text-lg text-[#4A5850] leading-relaxed max-w-xl font-normal text-pretty">
              Discover the melody, learn the solfa, understand the rhythm, and explore
              your song with your personal AI music companion. No more feeling lost when
              you open unfamiliar sheet music.
            </p>

            {/* Sight-reading Helper Link */}
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => onSelectSample(SAMPLE_SCORES[0])}
                className="inline-flex items-center gap-2 text-sm text-[#66766D] hover:text-[#153928] transition-colors group cursor-pointer text-left"
              >
                <span className="text-base leading-none" role="img" aria-label="Graduation cap">
                  🎓
                </span>
                <span>
                  New to sight-reading or sight-singing?{' '}
                  <span className="underline underline-offset-4 font-medium text-[#153928] group-hover:text-[#1F543B]">
                    Start here.
                  </span>
                </span>
              </button>
            </div>

            {/* Buttons Row: Dark pine green pill + Secondary text link */}
            <div className="pt-2 flex flex-wrap items-center gap-6 sm:gap-7">
              <button
                type="button"
                onClick={onLearnNewScore}
                className="min-h-[50px] px-8 py-3.5 rounded-full bg-[#153928] hover:bg-[#1C4B35] active:scale-[0.99] text-white font-medium text-base flex items-center justify-center gap-3 shadow-xs hover:shadow-md transition-all cursor-pointer group"
              >
                <span>Explore your first song</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>

              <a
                href="#how-it-works"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="inline-flex items-center gap-2 text-base font-medium text-[#153928] hover:text-[#1C4B35] transition-colors cursor-pointer group py-2"
              >
                <span>See how it works</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>

          {/* Right Column: Hero Photo & Interactive Floating Melody Card */}
          <div className="lg:col-span-6 relative">
            <div className="relative rounded-[2rem] sm:rounded-[2.5rem] overflow-hidden shadow-xl border border-black/5 bg-[#EAE3D2] transition-transform">
              <picture>
                <source srcSet="/assets/hero_choir_practice.webp" type="image/webp" />
                <img
                  src="/assets/hero_choir_practice.png"
                  alt="Singing choir practice together with tablet sheet music"
                  className="w-full h-auto object-cover block"
                  width={803}
                  height={731}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              </picture>

              {/* Interactive Live Melody Overlay Card on bottom-right matching reference design */}
              <div
                onClick={playHeroMelody}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playHeroMelody();
                  }
                }}
                title="Click to play melody preview"
                className="absolute right-3 sm:right-6 bottom-3 sm:bottom-6 bg-white/95 backdrop-blur-md rounded-2xl p-3.5 sm:p-4 shadow-xl border border-black/5 max-w-[240px] sm:max-w-[280px] w-full select-none cursor-pointer group hover:bg-white hover:scale-[1.02] transition-all"
              >
                {/* Card Header: Title + Animated Soundwave Icon */}
                <div className="flex items-center justify-between gap-2 mb-2 sm:mb-2.5">
                  <span className="text-xs sm:text-sm font-semibold text-[#1F2C24] flex items-center gap-1.5">
                    <span>New melody</span>
                    <span className="text-[10px] text-[#86948C] font-normal hidden sm:inline">
                      ({isPlayingMelody ? 'Playing...' : 'Click to hear'})
                    </span>
                  </span>

                  {/* Golden Waveform Bars */}
                  <div className="flex items-center gap-0.5" aria-hidden="true">
                    {[10, 16, 22, 14, 8].map((h, i) => (
                      <span
                        key={i}
                        style={{ height: `${h}px` }}
                        className={`w-0.5 rounded-full bg-[#C89335] transition-all ${
                          isPlayingMelody ? 'animate-pulse' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Stave Lines with Treble Clef, Notes, and Vertical Highlight */}
                <div className="relative h-14 sm:h-16 w-full flex items-center justify-center my-1">
                  {/* 5 Horizontal Staff Lines */}
                  <div className="absolute inset-x-0 inset-y-2 flex flex-col justify-between pointer-events-none opacity-45">
                    <div className="h-px bg-[#7A8C82] w-full" />
                    <div className="h-px bg-[#7A8C82] w-full" />
                    <div className="h-px bg-[#7A8C82] w-full" />
                    <div className="h-px bg-[#7A8C82] w-full" />
                    <div className="h-px bg-[#7A8C82] w-full" />
                  </div>

                  {/* Stave Graphic SVG */}
                  <svg
                    className="w-full h-full relative z-10"
                    viewBox="0 0 200 50"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    {/* Treble Clef Graphic */}
                    <text
                      x="10"
                      y="37"
                      fontSize="38"
                      fill="#1E2A22"
                      fontFamily="serif"
                      className="select-none"
                    >
                      𝄞
                    </text>

                    {/* Vertical Green Column Highlight Tracking Note */}
                    <rect
                      x={
                        activeNoteIndex === 0
                          ? 45
                          : activeNoteIndex === 1
                          ? 80
                          : activeNoteIndex === 2
                          ? 118
                          : 154
                      }
                      y="4"
                      width="20"
                      height="42"
                      rx="8"
                      fill="#D7EBE0"
                      fillOpacity="0.85"
                      stroke="#A8D6BD"
                      strokeWidth="1"
                      className="transition-all duration-200"
                    />

                    {/* Note 1: Do (C4 with ledger line) */}
                    <line x1="50" y1="41" x2="62" y2="41" stroke="#1E2A22" strokeWidth="1.2" />
                    <ellipse cx="55" cy="41" rx="4.5" ry="3.2" fill="#1E2A22" transform="rotate(-15 55 41)" />
                    <line x1="59" y1="41" x2="59" y2="15" stroke="#1E2A22" strokeWidth="1.2" />

                    {/* Note 2: Mi (E4 on bottom line) */}
                    <ellipse cx="90" cy="35" rx="4.5" ry="3.2" fill="#1E2A22" transform="rotate(-15 90 35)" />
                    <line x1="94" y1="35" x2="94" y2="10" stroke="#1E2A22" strokeWidth="1.2" />

                    {/* Note 3: Sol (G4 on 2nd line) */}
                    <ellipse cx="128" cy="28" rx="4.5" ry="3.2" fill="#1E2A22" transform="rotate(-15 128 28)" />
                    <line x1="132" y1="28" x2="132" y2="5" stroke="#1E2A22" strokeWidth="1.2" />

                    {/* Note 4: High Do (C5 on 3rd space) */}
                    <ellipse cx="164" cy="20" rx="4.5" ry="3.2" fill="#1E2A22" transform="rotate(-15 164 20)" />
                    <line x1="160" y1="20" x2="160" y2="44" stroke="#1E2A22" strokeWidth="1.2" />
                  </svg>
                </div>

                {/* Bottom Row: Solfa Syllables with Highlight Pill */}
                <div className="flex items-center justify-center gap-3 text-xs text-[#526359] pt-1">
                  <span
                    className={
                      activeNoteIndex === 0
                        ? 'font-bold text-[#1E5238] bg-[#D7EBE0] px-2 py-0.5 rounded-full'
                        : 'font-medium'
                    }
                  >
                    Do
                  </span>
                  <span className="text-[#9BAAA1]" aria-hidden="true">·</span>
                  <span
                    className={
                      activeNoteIndex === 1
                        ? 'font-bold text-[#1E5238] bg-[#D7EBE0] px-2.5 py-0.5 rounded-full'
                        : 'font-medium'
                    }
                  >
                    Mi
                  </span>
                  <span className="text-[#9BAAA1]" aria-hidden="true">·</span>
                  <span
                    className={
                      activeNoteIndex >= 2
                        ? 'font-bold text-[#1E5238] bg-[#D7EBE0] px-2 py-0.5 rounded-full'
                        : 'font-medium'
                    }
                  >
                    Sol
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          2. HOW IT WORKS: 4-PILLAR REHEARSAL WORKFLOW
         ──────────────────────────────────────────────────────────── */}
      <section id="how-it-works" className="space-y-8 pt-4 scroll-mt-24">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="flex items-center justify-center gap-2.5">
            <span className="w-6 h-[2px] bg-[#9E7B35] rounded-full inline-block" />
            <span className="text-xs font-semibold uppercase tracking-widest text-[#9E7B35]">
              How ChoirMate Works
            </span>
            <span className="w-6 h-[2px] bg-[#9E7B35] rounded-full inline-block" />
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl font-medium text-[#16221A]">
            From printed score to confident sight-singing
          </h2>
          <p className="text-sm sm:text-base text-[#526359] leading-relaxed">
            ChoirMate AI combines conservatory optical music recognition, movable-Do solfa,
            customizable rehearsal audio downloads, and AI vocal coaching in one seamless flow.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Step 1 */}
          <div className="bg-white/80 backdrop-blur-xs border border-[#E6DDCE] rounded-3xl p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#E4ECE7] text-[#143826] flex items-center justify-center mb-5">
                <FileText className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E7B35]">
                Step 01 • Full-Score OMR
              </span>
              <h3 className="font-serif text-xl font-medium text-[#16221A] mt-1.5">
                Multi-Page PDF &amp; Image Upload
              </h3>
              <p className="text-xs text-[#526359] mt-2.5 leading-relaxed">
                Upload entire multi-page PDF choir booklets, sheet music scans, or MusicXML files.
                All staves, measures, and SATB vocal parts stay synchronized with your original document.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-[#EFE8DD] flex items-center gap-2 text-[11px] font-semibold text-[#143826]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#143826]" />
              <span>Full-score system detection</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-white/80 backdrop-blur-xs border border-[#E6DDCE] rounded-3xl p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#F9F2DF] text-[#9E7B35] flex items-center justify-center mb-5">
                <Volume2 className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E7B35]">
                Step 02 • Solfa &amp; Edit
              </span>
              <h3 className="font-serif text-xl font-medium text-[#16221A] mt-1.5">
                Movable-Do Solfa &amp; Note Correction
              </h3>
              <p className="text-xs text-[#526359] mt-2.5 leading-relaxed">
                Instantly see Do–Re–Mi syllables mapped to the detected key signature for Soprano,
                Alto, Tenor, or Bass. Correct any pitch or duration with immediate solfa recalculation.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-[#EFE8DD] flex items-center gap-2 text-[11px] font-semibold text-[#143826]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#143826]" />
              <span>Key-aware Solfa calculation</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-white/80 backdrop-blur-xs border border-[#E6DDCE] rounded-3xl p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#E4ECE7] text-[#143826] flex items-center justify-center mb-5">
                <Download className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E7B35]">
                Step 03 • Audio Export
              </span>
              <h3 className="font-serif text-xl font-medium text-[#16221A] mt-1.5">
                Download MP3 &amp; WAV Audio
              </h3>
              <p className="text-xs text-[#526359] mt-2.5 leading-relaxed">
                Generate high-quality practice audio for the entire score or a selected measure
                range. Download true MP3 or WAV files to take to your choir rehearsals.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-[#EFE8DD] flex items-center gap-2 text-[11px] font-semibold text-[#143826]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#143826]" />
              <span>Choir &amp; piano rehearsal tracks</span>
            </div>
          </div>

          {/* Step 4 */}
          <div className="bg-white/80 backdrop-blur-xs border border-[#E6DDCE] rounded-3xl p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-[#F9F2DF] text-[#9E7B35] flex items-center justify-center mb-5">
                <Sparkles className="w-6 h-6" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#9E7B35]">
                Step 04 • Voice Coach
              </span>
              <h3 className="font-serif text-xl font-medium text-[#16221A] mt-1.5">
                Pitch Accuracy &amp; SmolLM2 Coach
              </h3>
              <p className="text-xs text-[#526359] mt-2.5 leading-relaxed">
                Sing along into your microphone with real-time pitch detection, and ask questions
                about intervals, breath support, or Latin pronunciation answered by local SmolLM2.
              </p>
            </div>
            <div className="mt-5 pt-4 border-t border-[#EFE8DD] flex items-center gap-2 text-[11px] font-semibold text-[#143826]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#143826]" />
              <span>Real-time pitch detector</span>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          3. FEATURES: INSTANT REPERTOIRE LIBRARY & DEMO
         ──────────────────────────────────────────────────────────── */}
      <section id="features" className="space-y-8 pt-4 scroll-mt-24">
        <div className="bg-white/80 backdrop-blur-xs border border-[#E6DDCE] rounded-3xl p-6 sm:p-10 shadow-xs">
          <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-[2px] bg-[#9E7B35] rounded-full inline-block" />
                <span className="text-xs font-semibold uppercase tracking-widest text-[#9E7B35]">
                  Instant Repertoire Library
                </span>
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-medium text-[#16221A]">
                Explore sample choral works right now
              </h2>
              <p className="text-xs sm:text-sm text-[#526359] mt-1.5 max-w-xl">
                Try ChoirMate immediately with these pre-analyzed SATB choral pieces. Hear individual vocal parts, inspect solfa, or download practice audio.
              </p>
            </div>

            <button
              type="button"
              onClick={onLearnNewScore}
              className="min-h-[44px] px-6 py-2.5 rounded-full bg-[#153928] hover:bg-[#1C4B35] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Your Own Score (PDF / Image)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SAMPLE_SCORES.map((score, index) => (
              <div
                key={score.id}
                className="bg-[#FAF7F0] border border-[#E8DFD0] rounded-2xl p-5 hover:border-[#153928]/40 hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-mono text-[#9E7B35] font-semibold">
                      Sample #{index + 1}
                    </span>
                    <span className="text-[11px] font-medium text-[#65766D] bg-[#EFE8DD] px-2 py-0.5 rounded-full">
                      {score.keySignature.key}
                    </span>
                  </div>

                  <h3 className="font-serif text-lg font-semibold text-[#16221A] group-hover:text-[#153928] transition-colors">
                    {score.title}
                  </h3>
                  <p className="text-xs text-[#65766D] mt-1">
                    {score.composer}
                  </p>

                  <p className="text-xs text-[#4A5850] mt-3 line-clamp-2 leading-relaxed">
                    {score.keySignature.explanation}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-[#E8DFD0] flex items-center justify-between gap-3">
                  <div className="text-[11px] text-[#65766D]">
                    {score.notes.length} notes · {score.tempo} BPM
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectSample(score)}
                    className="min-h-[38px] px-4 py-1.5 rounded-full bg-[#153928] group-hover:bg-[#1C4B35] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Open &amp; Sing</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
