import React, { useState } from 'react';
import { Play, RotateCcw, Volume2, Sparkles, CheckCircle2 } from 'lucide-react';
import { audioEngine, pitchToFrequency } from '../utils/audioPlayer';

export const SolfaTransformDemo: React.FC = () => {
  const [isTransformed, setIsTransformed] = useState(true);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  const demoNotes = [
    { pitch: 'G4', letter: 'G', solfa: 'Sol', count: '1 beat', word: 'A-' },
    { pitch: 'C5', letter: 'C', solfa: 'Do', count: '2 beats', word: '-maz-' },
    { pitch: 'E5', letter: 'E', solfa: 'Mi', count: '1/2 beat', word: '-ing' },
    { pitch: 'D5', letter: 'D', solfa: 'Re', count: '1 beat', word: 'grace' },
    { pitch: 'C5', letter: 'C', solfa: 'Do', count: '3 beats', word: '...' },
  ];

  const handlePlaySample = () => {
    audioEngine.stopPlayback();
    const formattedNotes = demoNotes.map((n) => ({
      frequency: pitchToFrequency(n.pitch),
      duration: n.count.includes('3') ? 1.5 : n.count.includes('2') ? 1.2 : n.count.includes('1/2') ? 0.4 : 0.8,
    }));

    audioEngine.playMelodySequence(
      formattedNotes,
      84,
      (idx) => setPlayingIndex(idx),
      () => setPlayingIndex(null)
    );
  };

  const handleSingleNote = (pitch: string, index: number) => {
    setPlayingIndex(index);
    audioEngine.playNote(pitchToFrequency(pitch), 0.7);
    setTimeout(() => {
      setPlayingIndex((prev) => (prev === index ? null : prev));
    }, 700);
  };

  return (
    <div className="w-full bg-[#FFFFFF] rounded-2xl border border-[#E8E1D2] shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="p-4 sm:p-5 bg-[#FAF7F0] border-b border-[#E8E1D2] flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-lg font-semibold text-[#142F23]">
              From Printed Score to Singing Solfa
            </h3>
            <span className="text-[11px] font-medium text-[#8B651B] bg-[#F7EFCF] px-2 py-0.5 rounded-sm">
              Live Preview
            </span>
          </div>
          <p className="text-xs text-[#52635B] mt-0.5">
            Watch how confusing stave positions become intuitive Solfa vocal syllables
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center bg-[#EFE9DC] p-0.5 rounded-lg text-xs font-medium">
          <button
            onClick={() => setIsTransformed(false)}
            className={`px-3 py-1.5 rounded-md transition-all ${
              !isTransformed
                ? 'bg-white text-[#142F23] shadow-xs font-semibold'
                : 'text-[#63756E] hover:text-[#142F23]'
            }`}
          >
            Raw Stave
          </button>
          <button
            onClick={() => setIsTransformed(true)}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              isTransformed
                ? 'bg-[#142F23] text-[#F9F2DF] shadow-xs font-semibold'
                : 'text-[#63756E] hover:text-[#142F23]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#DEAB3F]" />
            Choir Solfa
          </button>
        </div>
      </div>

      {/* Interactive Visual Representation */}
      <div className="p-5 sm:p-7">
        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {demoNotes.map((note, index) => {
            const isPlaying = playingIndex === index;
            return (
              <button
                key={index}
                onClick={() => handleSingleNote(note.pitch, index)}
                className={`relative group p-3 sm:p-4 rounded-xl text-center border transition-all flex flex-col items-center justify-between min-h-[140px] sm:min-h-[160px] ${
                  isPlaying
                    ? 'border-[#B2821E] bg-[#FBF6E9] shadow-md scale-102 ring-2 ring-[#DEAB3F]/30'
                    : 'border-[#EAE3D4] bg-[#FDFAF6] hover:border-[#295B47]/40 hover:bg-[#F9F6F0]'
                }`}
                aria-label={`Play note ${note.solfa} (${note.pitch})`}
              >
                {/* Step indicator */}
                <span className="text-[10px] font-mono text-[#8C9C94] tracking-wider">
                  0{index + 1}
                </span>

                {/* Main Note Representation */}
                <div className="my-auto">
                  {isTransformed ? (
                    // Transformed Solfa Syllable
                    <div className="flex flex-col items-center">
                      <span className="font-serif text-2xl sm:text-3xl font-bold text-[#142F23] group-hover:text-[#295B47] transition-colors">
                        {note.solfa}
                      </span>
                      <span className="text-[11px] font-semibold text-[#8B651B] mt-0.5">
                        {note.pitch}
                      </span>
                    </div>
                  ) : (
                    // Raw Technical Pitch
                    <div className="flex flex-col items-center">
                      <span className="font-mono text-xl sm:text-2xl font-semibold text-[#3D4F46]">
                        {note.pitch}
                      </span>
                      <span className="text-[10px] text-[#8C9C94] mt-0.5">
                        Ledger Line
                      </span>
                    </div>
                  )}
                </div>

                {/* Lyric & Duration Footer */}
                <div className="w-full border-t border-[#EAE3D4] pt-2 mt-2">
                  <span className="block font-serif italic text-xs sm:text-sm text-[#142F23] truncate">
                    {note.word}
                  </span>
                  <span className="block text-[10px] text-[#71827A] mt-0.5">
                    {note.count}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Demo Controls */}
        <div className="mt-5 pt-4 border-t border-[#EAE3D4] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#52635B]">
            <Volume2 className="w-4 h-4 text-[#8B651B]" />
            <span>Click any box to hear its real choral pitch</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePlaySample}
              disabled={playingIndex !== null}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#142F23] text-[#F9F2DF] text-xs font-semibold hover:bg-[#1F4737] active:scale-98 transition disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-[#DEAB3F] text-[#DEAB3F]" />
              <span>{playingIndex !== null ? 'Playing...' : 'Play Phrase Audio'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
