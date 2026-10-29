import React, { useState, Suspense, lazy, useCallback } from 'react';
import { Header } from './components/Header';
import { HomeScreen } from './components/HomeScreen';
import { PitchDeckModal } from './components/PitchDeckModal';
import { ScoreAnalysis } from './types/music';
import { SAMPLE_SCORES } from './data/sampleScores';

// Dynamic code-splitting for heavy studio workspaces:
// The initial landing page loads instantly without downloading OMR, PDF rendering, or Web Audio export upfront.
const SheetWorkspace = lazy(() =>
  import('./components/SheetWorkspace').then((m) => ({ default: m.SheetWorkspace }))
);
const LearningResults = lazy(() =>
  import('./components/LearningResults').then((m) => ({ default: m.LearningResults }))
);
const PracticeMode = lazy(() =>
  import('./components/PracticeMode').then((m) => ({ default: m.PracticeMode }))
);

const WorkspaceLoader: React.FC<{ label: string }> = ({ label }) => (
  <div className="min-h-[420px] flex flex-col items-center justify-center p-8 text-center space-y-4 animate-in fade-in duration-200">
    <div className="w-10 h-10 rounded-full border-3 border-[#143826]/20 border-t-[#143826] animate-spin" />
    <div>
      <p className="font-serif text-lg font-medium text-[#16221A]">{label}</p>
      <p className="text-xs text-[#526359] mt-1">Preparing choral analysis studio...</p>
    </div>
  </div>
);

export function App() {
  const [currentScreen, setCurrentScreen] = useState<'home' | 'workspace' | 'results' | 'practice'>('home');
  const [currentScore, setCurrentScore] = useState<ScoreAnalysis | null>(
    SAMPLE_SCORES[0] || null
  );
  const [selectedPartId, setSelectedPartId] = useState<string>('P1');
  const [showPitchDeck, setShowPitchDeck] = useState<boolean>(false);

  const handleScoreAnalyzed = useCallback((score: ScoreAnalysis) => {
    setCurrentScore(score);
    const defaultPartId =
      score.selectedPartId ||
      (score.parts && score.parts.length > 0 ? score.parts[0].id || score.parts[0].partId || 'P1' : 'P1');
    setSelectedPartId(defaultPartId);
    setCurrentScreen('results');
  }, []);

  const handleScoreUpdated = useCallback((updatedScore: ScoreAnalysis) => {
    setCurrentScore(updatedScore);
  }, []);

  return (
    <div className="min-h-screen bg-[#FAF5ED] text-[#16221A] flex flex-col font-sans selection:bg-[#E2ECE5] selection:text-[#143826]">
      <Header
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        hasScore={Boolean(currentScore)}
        onOpenPitchDeck={() => setShowPitchDeck(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8">
        {currentScreen === 'home' && (
          <HomeScreen
            onLearnNewScore={() => setCurrentScreen('workspace')}
            onSelectSample={handleScoreAnalyzed}
          />
        )}

        {currentScreen === 'workspace' && (
          <Suspense fallback={<WorkspaceLoader label="Loading Score Workspace" />}>
            <SheetWorkspace onScoreAnalyzed={handleScoreAnalyzed} />
          </Suspense>
        )}

        {currentScreen === 'results' && currentScore && (
          <Suspense fallback={<WorkspaceLoader label="Loading Music & Solfa Studio" />}>
            <LearningResults
              score={currentScore}
              selectedPartId={selectedPartId}
              onSelectPart={setSelectedPartId}
              onScoreUpdated={handleScoreUpdated}
              onStartPractice={() => setCurrentScreen('practice')}
            />
          </Suspense>
        )}

        {currentScreen === 'practice' && currentScore && (
          <Suspense fallback={<WorkspaceLoader label="Starting Pitch & Voice Coach" />}>
            <PracticeMode
              score={currentScore}
              selectedPartId={selectedPartId}
              onSelectPart={setSelectedPartId}
              onBackToLearn={() => setCurrentScreen('results')}
            />
          </Suspense>
        )}
      </main>

      <footer className="border-t border-[#E8E0D0] bg-[#FAF5ED] py-6 px-4 sm:px-8 lg:px-12 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#637269]">
          <p className="font-serif font-semibold text-[#143826]">
            ChoirMate AI — Full-Score Optical Music Recognition, Multi-Part Solfa &amp; Sight-Singing Tutor
          </p>
          <p>
            Powered by Open-Weight HOMR (Multi-System MusicXML OMR) &amp; SmolLM2-360M-Instruct-GGUF
          </p>
        </div>
      </footer>

      {/* OPEN//BUILD 2026 Pitch Deck Modal */}
      <PitchDeckModal isOpen={showPitchDeck} onClose={() => setShowPitchDeck(false)} />
    </div>
  );
}

export default App;
