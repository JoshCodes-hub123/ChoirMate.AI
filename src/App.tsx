import React, { useState, Suspense, lazy, useCallback } from 'react';
import { FileUp, Sparkles, BookOpen } from 'lucide-react';
import { Header, Screen } from './components/Header';
import { HomeScreen } from './components/HomeScreen';
import { PitchDeckModal } from './components/PitchDeckModal';
import { ScoreAnalysis, ScoreProvenance } from './types/music';
import { SAMPLE_SCORES } from './data/sampleScores';
import { audioEngine } from './utils/audioPlayer';

const SheetWorkspace = lazy(() =>
  import('./components/SheetWorkspace').then((m) => ({ default: m.SheetWorkspace }))
);
const LearningResults = lazy(() =>
  import('./components/LearningResults').then((m) => ({ default: m.LearningResults }))
);
const PracticeMode = lazy(() =>
  import('./components/PracticeMode').then((m) => ({ default: m.PracticeMode }))
);
const VoiceStudio = lazy(() =>
  import('./components/VoiceStudio').then((m) => ({ default: m.VoiceStudio }))
);

const WorkspaceLoader: React.FC<{ label: string }> = ({ label }) => (
  <div className="min-h-[420px] flex flex-col items-center justify-center p-8 text-center space-y-4">
    <div className="w-10 h-10 rounded-full border-3 border-[#143826]/20 border-t-[#143826] animate-spin" />
    <div>
      <p className="font-serif text-lg font-medium text-[#16221A]">{label}</p>
      <p className="text-xs text-[#526359] mt-1">Preparing choral studio...</p>
    </div>
  </div>
);

export function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  // IMPORTANT: Never initialize currentScore with built-in demo music on startup.
  const [currentScore, setCurrentScore] = useState<ScoreAnalysis | null>(null);
  const [scoreProvenance, setScoreProvenance] = useState<ScoreProvenance | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string>('P1');
  const [showPitchDeck, setShowPitchDeck] = useState<boolean>(false);

  const resolveDefaultPartId = (score: ScoreAnalysis): string => {
    if (score.selectedPartId) return score.selectedPartId;
    if (score.parts && score.parts.length > 0) {
      return score.parts[0].id || score.parts[0].partId || 'P1';
    }
    return 'P1';
  };

  /**
   * Called ONLY when a real user-uploaded score has been analyzed by the Python backend.
   */
  const handleUploadedScoreAnalyzed = useCallback((analyzedScore: ScoreAnalysis) => {
    audioEngine.stop();
    const cleanScore: ScoreAnalysis = {
      ...analyzedScore,
      isDemonstration: false,
    };
    setCurrentScore(cleanScore);
    setScoreProvenance('upload');
    setSelectedPartId(resolveDefaultPartId(cleanScore));
    setCurrentScreen('results');
  }, []);

  /**
   * Called ONLY when the user explicitly clicks a labeled Demo Score button.
   */
  const handleSelectDemoScore = useCallback(
    (demoScore: ScoreAnalysis, targetScreen: Screen = 'results') => {
      audioEngine.stop();
      const labeledDemo: ScoreAnalysis = {
        ...demoScore,
        isDemonstration: true,
      };
      setCurrentScore(labeledDemo);
      setScoreProvenance('demo');
      setSelectedPartId(resolveDefaultPartId(labeledDemo));
      setCurrentScreen(targetScreen);
    },
    []
  );

  const handleScoreUpdated = useCallback((updatedScore: ScoreAnalysis) => {
    setCurrentScore((prev) => ({
      ...updatedScore,
      isDemonstration: prev?.isDemonstration ?? updatedScore.isDemonstration ?? false,
    }));
  }, []);

  const handleNavigate = useCallback((nextScreen: Screen) => {
    audioEngine.stop();
    setCurrentScreen(nextScreen);
  }, []);

  const handleStartNewUpload = useCallback(() => {
    audioEngine.stop();
    setCurrentScreen('workspace');
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF5ED] text-[#16221A] flex flex-col font-sans selection:bg-[#E2ECE5] selection:text-[#143826]">
      <Header
        currentScreen={currentScreen}
        onNavigate={handleNavigate}
        currentScore={currentScore}
        scoreProvenance={scoreProvenance}
        onStartNewUpload={handleStartNewUpload}
        onOpenPitchDeck={() => setShowPitchDeck(true)}
      />

      <main className="flex-1 w-full">
        {currentScreen === 'home' && (
          <HomeScreen
            onLearnNewScore={handleStartNewUpload}
            onSelectSample={(demo, screen) => handleSelectDemoScore(demo, screen || 'results')}
          />
        )}

        {currentScreen === 'workspace' && (
          <Suspense fallback={<WorkspaceLoader label="Loading Score Upload Workspace" />}>
            <SheetWorkspace
              onAnalysisComplete={handleUploadedScoreAnalyzed}
              onSelectDemoScore={(demo) => handleSelectDemoScore(demo, 'results')}
              activeScore={currentScore}
            />
          </Suspense>
        )}

        {currentScreen === 'voice-studio' && (
          <Suspense fallback={<WorkspaceLoader label="Loading SATB Voice Studio" />}>
            <VoiceStudio
              score={currentScore}
              scoreProvenance={scoreProvenance}
              onUploadNewScore={handleStartNewUpload}
              onSelectDemoScore={(demo) => handleSelectDemoScore(demo, 'voice-studio')}
            />
          </Suspense>
        )}

        {(currentScreen === 'results' || currentScreen === 'practice') && !currentScore && (
          <div className="max-w-4xl mx-auto px-4 sm:px-8 py-12">
            <div className="bg-white rounded-2xl border border-[#DFD6C3] p-8 sm:p-12 text-center space-y-6 shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-[#143826]/10 text-[#143826] flex items-center justify-center mx-auto">
                <BookOpen className="w-8 h-8" />
              </div>
              <div className="max-w-lg mx-auto space-y-2">
                <span className="text-xs font-bold uppercase tracking-widest text-[#9E7B35]">
                  No Active Score Selected
                </span>
                <h1 className="font-serif text-3xl font-bold text-[#143826]">
                  Upload Your Sheet Music to Begin
                </h1>
                <p className="text-sm text-[#4F5F56] leading-relaxed">
                  Upload a MusicXML file, sheet music image, or PDF score to inspect its notes, solfa syllables, and rhythm breakdown—or choose one of our labeled Demo Scores below.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleStartNewUpload}
                  className="px-5 py-3 rounded-xl bg-[#143826] hover:bg-[#1B4B33] text-white text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  <span>Upload Sheet Music</span>
                </button>
                {SAMPLE_SCORES[0] && (
                  <button
                    type="button"
                    onClick={() => handleSelectDemoScore(SAMPLE_SCORES[0], currentScreen)}
                    className="px-5 py-3 rounded-xl border border-[#143826] text-[#143826] hover:bg-[#143826]/5 text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-[#9E7B35]" />
                    <span>Load Demo Score ({SAMPLE_SCORES[0].title})</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {currentScreen === 'results' && currentScore && (
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8">
            <Suspense fallback={<WorkspaceLoader label="Loading Score Breakdown & Solfa Studio" />}>
              <LearningResults
                score={currentScore}
                selectedPartId={selectedPartId}
                onSelectPart={setSelectedPartId}
                onScoreUpdated={handleScoreUpdated}
                onStartPractice={() => handleNavigate('practice')}
                onOpenVoiceStudio={() => handleNavigate('voice-studio')}
                onUploadAnother={handleStartNewUpload}
              />
            </Suspense>
          </div>
        )}

        {currentScreen === 'practice' && currentScore && (
          <div className="max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8">
            <Suspense fallback={<WorkspaceLoader label="Starting Sight-Singing Practice Coach" />}>
              <PracticeMode
                score={currentScore}
                selectedPartId={selectedPartId}
                onSelectPart={setSelectedPartId}
                onBackToLearn={() => handleNavigate('results')}
              />
            </Suspense>
          </div>
        )}
      </main>

      <footer className="border-t border-[#E5DEC9] bg-[#FAF5ED] py-6 px-4 sm:px-8 lg:px-12 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#637269]">
          <p className="font-serif font-semibold text-[#143826]">
            ChoirMate AI — Choral Score Analysis, Movable-Do Solfa &amp; SATB Rehearsal Studio
          </p>
          <p>
            Powered by Python Music Theory Engine, HOMR Optical Music Recognition &amp; SmolLM2-360M-Instruct
          </p>
        </div>
      </footer>

      <PitchDeckModal isOpen={showPitchDeck} onClose={() => setShowPitchDeck(false)} />
    </div>
  );
}

export default App;
