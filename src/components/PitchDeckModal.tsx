import React, { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Presentation, Sparkles, Mic, FileText, Cpu, GitBranch, Heart } from 'lucide-react';

interface PitchDeckModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SlideData {
  number: number;
  title: string;
  subtitle: string;
  category: string;
  content: React.ReactNode;
  speakerNotes: string;
}

export const PitchDeckModal: React.FC<PitchDeckModalProps> = ({ isOpen, onClose }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showNotes, setShowNotes] = useState(true);

  if (!isOpen) return null;

  const slides: SlideData[] = [
    {
      number: 1,
      category: "OPEN//BUILD 2026 • Vision & Introduction",
      title: "ChoirMate AI",
      subtitle: "Making music easier to read, understand, and sing.",
      content: (
        <div className="space-y-6">
          <div className="p-8 rounded-3xl bg-gradient-to-br from-[#143826] to-[#0A2216] text-[#FAF5ED] shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#9E7B35]/10 rounded-full blur-3xl pointer-events-none" />
            <span className="inline-block px-3 py-1 rounded-full bg-[#9E7B35]/20 text-[#D8B46C] text-xs font-semibold tracking-wider uppercase mb-4 border border-[#9E7B35]/30">
              Theme: AI Belongs to Everyone
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              ChoirMate AI
            </h2>
            <p className="text-[#E2ECE5] text-base sm:text-lg max-w-2xl font-light leading-relaxed">
              An open-weight optical music recognition, Movable-Do solfa tutor, and practice audio studio designed for community choirs and beginner musicians.
            </p>
            <div className="mt-8 pt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-[#C5D3CB]">
              <div>
                <p className="font-semibold text-white">Abayomi Joshua O.</p>
                <p className="text-[#9E7B35]">Federal University of Technology, Akure (FUTA)</p>
              </div>
              <div>
                <p className="font-semibold text-white">Adam Lawal</p>
                <p className="text-[#9E7B35]">Federal University of Technology, Akure (FUTA)</p>
              </div>
            </div>
          </div>
        </div>
      ),
      speakerNotes:
        "Hello judges and fellow builders. My name is Abayomi Joshua O., building alongside my teammate Adam Lawal from the Federal University of Technology, Akure. For our OPEN//BUILD 2026 submission, we created ChoirMate AI because we believe AI belongs to everyone—especially singers in community and church choirs who love music deeply but struggle to decode traditional sheet music notation."
    },
    {
      number: 2,
      category: "The Human Problem",
      title: "Loving to sing is not the same as knowing how to read music.",
      subtitle: "The barrier between passion and independent rehearsal.",
      content: (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-4">
            <div className="w-10 h-10 rounded-xl bg-[#9E7B35]/10 flex items-center justify-center text-[#9E7B35]">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-bold text-lg text-[#143826]">The Rehearsal Dilemma</h3>
            <p className="text-sm text-[#526359] leading-relaxed">
              Imagine a church choir member who genuinely loves singing but cannot confidently read staff lines, clefs, accidentals, or dotted rhythms. When the director distributes a score and asks everyone to practise at home, the page feels like an unfamiliar language.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-4">
            <div className="w-10 h-10 rounded-xl bg-[#143826]/10 flex items-center justify-center text-[#143826]">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="font-serif font-bold text-lg text-[#143826]">Relying on Rote Learning</h3>
            <p className="text-sm text-[#526359] leading-relaxed">
              Without accessible tools, singers depend entirely on phone recordings of piano playbacks, imitate section leaders, or struggle in isolation. This bottleneck undermines confidence, slows concert readiness, and excludes passionate voices from participation.
            </p>
          </div>
        </div>
      ),
      speakerNotes:
        "This challenge is personal. In many community choirs across Nigeria and around the world, singers receive complex choral sheets during weekly rehearsals. If you cannot read notes, you are forced to rely on rote learning—recording the choir master's piano on your phone or guessing your parts at home. The problem isn't talent or passion; it's the lack of accessible, personalized music learning support."
    },
    {
      number: 3,
      category: "Our Solution",
      title: "From unfamiliar notes to guided practice.",
      subtitle: "An end-to-end workflow designed for the modern choir member.",
      content: (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { step: "01", title: "Upload Score", desc: "PDF, PNG scan, or MusicXML intake." },
            { step: "02", title: "HOMR OMR", desc: "Extract staves, clefs, and notes." },
            { step: "03", title: "Solfa Mapping", desc: "Instant Movable-Do translation." },
            { step: "04", title: "Audio & Coaching", desc: "MP3 export & AI vocal tutor." },
          ].map((item, idx) => (
            <div key={idx} className="p-5 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-2">
              <span className="text-xs font-bold text-[#9E7B35] tracking-wider">{item.step}</span>
              <h4 className="font-serif font-bold text-[#143826] text-base">{item.title}</h4>
              <p className="text-xs text-[#526359] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      ),
      speakerNotes:
        "ChoirMate AI solves this through a clean four-step workflow. Users upload a PDF score or scan. Our backend processes it using HOMR optical music recognition, maps the notes into Movable-Do Solfa syllables across SATB voice parts, allows interactive note editing, and generates downloadable practice MP3s alongside grounded AI coaching."
    },
    {
      number: 4,
      category: "Technology & Architecture",
      title: "A music-learning pipeline, not just a chatbot.",
      subtitle: "Separating computer vision, music theory, and language generation.",
      content: (
        <div className="p-6 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="p-4 rounded-xl bg-[#FAF5ED] border border-[#E8E0D0]">
              <span className="text-xs font-bold text-[#9E7B35] uppercase">Perception</span>
              <p className="font-serif font-bold text-[#143826] mt-1">HOMR &amp; pypdfium2</p>
              <p className="text-xs text-[#526359] mt-1">Optical music recognition for staves and noteheads.</p>
            </div>
            <div className="p-4 rounded-xl bg-[#FAF5ED] border border-[#E8E0D0]">
              <span className="text-xs font-bold text-[#143826] uppercase">Deterministic Theory</span>
              <p className="font-serif font-bold text-[#143826] mt-1">music21 &amp; SciPy</p>
              <p className="text-xs text-[#526359] mt-1">Solfa syllable mapping, key signatures, and audio synthesis.</p>
            </div>
            <div className="p-4 rounded-xl bg-[#FAF5ED] border border-[#E8E0D0]">
              <span className="text-xs font-bold text-[#9E7B35] uppercase">Reasoning</span>
              <p className="font-serif font-bold text-[#143826] mt-1">SmolLM2-360M</p>
              <p className="text-xs text-[#526359] mt-1">Open-weight natural language practice explanations.</p>
            </div>
          </div>
        </div>
      ),
      speakerNotes:
        "Architecturally, we deliberately separate concerns. We don't rely on a chatbot to guess musical notes. Computer vision via HOMR handles visual parsing; deterministic Python libraries like music21 handle music theory and Solfa calculations; and our compact open-weight language model explains theory and answers user questions."
    },
    {
      number: 5,
      category: "Open-Weight AI Decision",
      title: "Small model. Deliberate architecture.",
      subtitle: "Why we chose SmolLM2-360M-Instruct in GGUF format.",
      content: (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-3">
            <h4 className="font-serif font-bold text-lg text-[#143826]">Why SmolLM2-360M?</h4>
            <p className="text-sm text-[#526359] leading-relaxed">
              We explored this 360M parameter model for lightweight deployment, self-hosted control, and privacy. It runs efficiently on CPU (&lt;300MB RAM) without expensive GPU overhead.
            </p>
          </div>
          <div className="p-6 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-3">
            <h4 className="font-serif font-bold text-lg text-[#143826]">Honest Boundaries &amp; Limits</h4>
            <p className="text-sm text-[#526359] leading-relaxed">
              We acknowledge its limitations: limited reasoning capacity and dependency on structured input. It acts as a pedagogical assistant, while deterministic music theory engines handle core musical accuracy.
            </p>
          </div>
        </div>
      ),
      speakerNotes:
        "We chose bartowski/SmolLM2-360M-Instruct-GGUF because it fits our ethos: lightweight, self-hosted, and efficient. It runs smoothly on standard CPU instances without hefty cloud GPU costs. We are transparent about its limitations—it provides pedagogical coaching, while our deterministic Python music-theory pipeline guarantees exact musical correctness."
    },
    {
      number: 6,
      category: "Engineering & Deployment Story",
      title: "Making the prototype work beyond the development environment.",
      subtitle: "Overcoming real infrastructure challenges on Cloud Run.",
      content: (
        <div className="p-6 rounded-2xl bg-white border border-[#E8E0D0] shadow-xs space-y-4">
          <div className="space-y-3 text-sm text-[#526359]">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#143826] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
              <p><strong>Port Timing Issue:</strong> Initial deployment failed because Node.js waited synchronously for the Python service startup, exceeding Cloud Run's port binding timeout.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#143826] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
              <p><strong>Missing Executable (`ENOENT`):</strong> Discovered that `python3` runtime paths differed in slim production containers.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#143826] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">3</span>
              <p><strong>Robust Fallbacks:</strong> Decoupled process startup and introduced intelligent Node.js-based fallback handlers to guarantee 100% uptime and health check success.</p>
            </div>
          </div>
        </div>
      ),
      speakerNotes:
        "Building a hybrid Node/Python app in serverless containers taught us valuable engineering lessons. We tackled port timeout issues caused by synchronous startup, resolved Python executable paths (`ENOENT`), and implemented robust fallback handlers. This ensures the app remains stable and responsive under all conditions."
    },
    {
      number: 7,
      category: "Conclusion & Vision",
      title: "Every singer deserves a way to learn.",
      subtitle: "Help us make music easier to read, understand, and sing.",
      content: (
        <div className="p-8 rounded-3xl bg-[#143826] text-[#FAF5ED] shadow-xl space-y-6">
          <h3 className="font-serif text-2xl font-bold">Join Our Mission</h3>
          <p className="text-[#E2ECE5] text-sm leading-relaxed max-w-2xl">
            ChoirMate AI proves that open-weight AI and accessible design can empower thousands of community singers and students who previously felt locked out of music literacy.
          </p>
          <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-[#C5D3CB]">
            <div>
              <p className="font-semibold text-white">GitHub Repository</p>
              <a href="https://github.com/JoshCodes-hub123/ChoirMate.AI" target="_blank" rel="noreferrer" className="text-[#D8B46C] hover:underline">
                github.com/JoshCodes-hub123/ChoirMate.AI
              </a>
            </div>
            <div>
              <p className="font-semibold text-white">Live Cloud Run Demo</p>
              <a href="https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app" target="_blank" rel="noreferrer" className="text-[#D8B46C] hover:underline">
                Open Live Application
              </a>
            </div>
          </div>
        </div>
      ),
      speakerNotes:
        "In closing, every singer deserves a way to learn. ChoirMate AI bridges the gap between printed notation and independent musical confidence. Check out our GitHub repository and live demonstration. Thank you for your time, and help us make music easier to read, understand, and sing."
    }
  ];

  const slide = slides[currentSlide];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div className="bg-[#FAF5ED] border border-[#E4DCCF] rounded-3xl max-w-5xl w-full max-h-[92vh] shadow-2xl flex flex-col overflow-hidden text-[#16221A]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#E8E0D0] flex items-center justify-between bg-white/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#143826] text-white flex items-center justify-center">
              <Presentation className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#9E7B35]">
                {slide.category}
              </span>
              <h2 className="font-serif font-bold text-base text-[#143826]">
                Slide {slide.number} of {slides.length}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowNotes(!showNotes)}
              className="text-xs px-3 py-1.5 rounded-full border border-[#143826]/20 hover:bg-[#143826]/5 font-medium transition-colors cursor-pointer text-[#143826]"
            >
              {showNotes ? 'Hide Speaker Notes' : 'Show Speaker Notes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[#738279] hover:text-[#16221A] p-1.5 rounded-full hover:bg-black/5 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body / Slide View */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 space-y-6">
          <div className="space-y-2">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#143826] tracking-tight">
              {slide.title}
            </h1>
            <p className="text-sm sm:text-base text-[#526359] font-light">
              {slide.subtitle}
            </p>
          </div>

          <div className="py-2">
            {slide.content}
          </div>

          {showNotes && (
            <div className="mt-6 p-5 rounded-2xl bg-white border border-[#E8E0D0] shadow-2xs space-y-2 border-l-4 border-l-[#9E7B35]">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#9E7B35]">
                <Sparkles className="w-3.5 h-3.5" />
                Speaker Notes (Abayomi's Voice)
              </div>
              <p className="text-sm text-[#38443D] leading-relaxed italic">
                "{slide.speakerNotes}"
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer / Navigation */}
        <div className="px-6 py-4 border-t border-[#E8E0D0] bg-white/80 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {slides.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentSlide(idx)}
                className={`w-2.5 h-2.5 rounded-full transition-all cursor-pointer ${
                  currentSlide === idx ? 'bg-[#143826] w-6' : 'bg-[#D3DDD6] hover:bg-[#A3B5AA]'
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCurrentSlide((prev) => Math.max(0, prev - 1))}
              disabled={currentSlide === 0}
              className="px-4 py-2 rounded-xl border border-[#143826]/20 text-[#143826] text-xs font-medium hover:bg-[#143826]/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-1.5"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCurrentSlide((prev) => Math.min(slides.length - 1, prev + 1))}
              disabled={currentSlide === slides.length - 1}
              className="px-4 py-2 rounded-xl bg-[#143826] text-white text-xs font-medium hover:bg-[#0A2216] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-1.5"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
