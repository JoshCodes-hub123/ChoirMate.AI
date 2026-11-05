import React, { useState } from 'react';
import {
  AudioLines,
  BookOpen,
  FileUp,
  Home,
  Menu,
  Mic,
  Presentation,
  Sparkles,
  X,
} from 'lucide-react';
import { ScoreAnalysis, ScoreProvenance } from '../types/music';

export type Screen = 'home' | 'workspace' | 'results' | 'voice-studio' | 'practice';

interface HeaderProps {
  currentScreen: Screen;
  onNavigate: (screen: Screen) => void;
  currentScore: ScoreAnalysis | null;
  scoreProvenance: ScoreProvenance | null;
  onStartNewUpload: () => void;
  onOpenPitchDeck?: () => void;
}

const NAV_ITEMS: Array<{
  id: Screen;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresScore?: boolean;
}> = [
  { id: 'home', label: 'Home', shortLabel: 'Home', icon: Home },
  { id: 'workspace', label: 'Upload & Analyze', shortLabel: 'Upload', icon: FileUp },
  {
    id: 'results',
    label: 'Score Breakdown',
    shortLabel: 'Breakdown',
    icon: BookOpen,
    requiresScore: true,
  },
  {
    id: 'voice-studio',
    label: 'SATB Voice Studio',
    shortLabel: 'SATB Studio',
    icon: AudioLines,
    requiresScore: true,
  },
  {
    id: 'practice',
    label: 'Practice Coach',
    shortLabel: 'Practice',
    icon: Mic,
    requiresScore: true,
  },
];

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  onNavigate,
  currentScore,
  scoreProvenance,
  onStartNewUpload,
  onOpenPitchDeck,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (screen: Screen) => {
    setMobileMenuOpen(false);
    onNavigate(screen);
  };

  const isDemo = Boolean(currentScore?.isDemonstration || scoreProvenance === 'demo');

  return (
    <header className="sticky top-0 z-40 bg-[#FAF5ED]/95 backdrop-blur-md border-b border-[#E5DEC9]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 h-16 sm:h-[72px] flex items-center justify-between gap-4">
        {/* Zone 1: Brand & Active Score Provenance */}
        <div className="flex items-center gap-3 min-w-0 shrink-0">
          <button
            type="button"
            onClick={() => handleNavClick('home')}
            className="flex items-center gap-2.5 text-left group cursor-pointer focus:outline-none"
            aria-label="ChoirMate AI Home"
          >
            <img
              src="/assets/choirmate_logo_mark.png"
              alt="ChoirMate AI"
              className="h-9 sm:h-10 w-auto object-contain shrink-0"
              width={32}
              height={40}
            />
            <div className="hidden sm:block">
              <span className="font-serif text-lg font-bold tracking-tight text-[#143826] block leading-none">
                ChoirMate AI
              </span>
              <span className="text-[10px] font-medium tracking-widest uppercase text-[#637269] block mt-0.5">
                Choral Score & SATB Studio
              </span>
            </div>
          </button>

          {currentScore && (
            <div
              className={`hidden xl:flex items-center gap-2 pl-3 ml-1 border-l border-[#DED6C3] text-xs max-w-[230px] ${
                isDemo ? 'text-[#8B6914]' : 'text-[#143826]'
              }`}
              title={`${isDemo ? 'Demo Score' : 'Uploaded Score'}: ${currentScore.title}`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isDemo ? 'bg-[#C4962C]' : 'bg-[#1D7A4C]'
                }`}
              />
              <div className="truncate">
                <span className="font-semibold uppercase tracking-wider text-[10px] block leading-none opacity-75">
                  {isDemo ? 'Demo Mode' : 'Active Upload'}
                </span>
                <span className="font-medium truncate block mt-0.5 text-[#16221A]">
                  {currentScore.title}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Zone 2: Desktop Primary Navigation */}
        <nav
          className="hidden md:flex items-center gap-1 bg-[#F2ECE1] p-1 rounded-xl border border-[#E4DCCB]"
          aria-label="Primary Navigation"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentScreen === item.id;
            const isMuted = item.requiresScore && !currentScore;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`px-3 lg:px-3.5 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-[#143826] text-white shadow-xs'
                    : isMuted
                    ? 'text-[#6B7970] hover:text-[#143826] hover:bg-white/60'
                    : 'text-[#16221A] hover:text-[#143826] hover:bg-white/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
                <span className="lg:hidden">{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              onStartNewUpload();
            }}
            className="px-3.5 sm:px-4 py-2 rounded-xl bg-[#143826] hover:bg-[#1B4B33] text-white text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <FileUp className="w-3.5 h-3.5 shrink-0" />
            <span>Upload Score</span>
          </button>

          {onOpenPitchDeck && (
            <button
              type="button"
              onClick={onOpenPitchDeck}
              className="hidden sm:flex px-3 py-2 rounded-xl border border-[#D4C7B0] bg-white/80 hover:bg-white text-[#143826] text-xs font-semibold transition-all items-center gap-1.5 cursor-pointer"
              title="Open OPEN//BUILD Pitch Deck"
            >
              <Presentation className="w-3.5 h-3.5 text-[#9E7B35] shrink-0" />
              <span className="hidden lg:inline">Pitch Deck</span>
            </button>
          )}

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-xl border border-[#DFD6C5] text-[#143826] hover:bg-[#EFE8DC] cursor-pointer"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#E5DEC9] bg-[#FAF5ED] px-4 pt-3 pb-5 space-y-2 shadow-lg">
          {currentScore && (
            <div
              className={`px-3 py-2 rounded-xl border text-xs flex items-center justify-between ${
                isDemo
                  ? 'bg-[#FDF6E4] border-[#E8CF8C] text-[#7D5B0F]'
                  : 'bg-[#E9F3EC] border-[#B8D8C4] text-[#143826]'
              }`}
            >
              <div className="truncate pr-2">
                <span className="font-bold uppercase tracking-wider text-[10px] block">
                  {isDemo ? 'Demo Score Active' : 'Uploaded Score Active'}
                </span>
                <span className="font-semibold truncate block">{currentScore.title}</span>
              </div>
              <Sparkles className="w-4 h-4 shrink-0" />
            </div>
          )}

          <div className="grid grid-cols-1 gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-left text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#143826] text-white'
                      : 'text-[#16221A] hover:bg-[#EFE8DC]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.requiresScore && !currentScore && (
                    <span className="text-[10px] opacity-70 font-normal">Requires score</span>
                  )}
                </button>
              );
            })}
          </div>

          {onOpenPitchDeck && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenPitchDeck();
              }}
              className="w-full mt-2 px-3.5 py-2.5 rounded-xl border border-[#D4C7B0] bg-white text-[#143826] text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Presentation className="w-4 h-4 text-[#9E7B35]" />
              <span>View OPEN//BUILD Pitch Deck</span>
            </button>
          )}
        </div>
      )}
    </header>
  );
};
