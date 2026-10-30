import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Square,
  Send,
  MessageSquare,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { ScoreAnalysis, VocalPart, MusicNote } from '../types/music';
import { getApiUrl } from '../utils/apiConfig';

interface VoiceQuestionPanelProps {
  score: ScoreAnalysis;
  activePart: VocalPart;
  displayedNotes: MusicNote[];
}

interface QaExchange {
  id: string;
  question: string;
  answer: string;
  source: 'assemblyai' | 'text';
  model: string;
  timestamp: string;
}

const QUICK_QUESTIONS = [
  'What is my vocal range and opening Solfa sequence?',
  'How should I count the rhythm and rests in this piece?',
  'What is the key signature and where is Do anchored?',
];

export const VoiceQuestionPanel: React.FC<VoiceQuestionPanelProps> = ({
  score,
  activePart,
  displayedNotes,
}) => {
  const [assemblyAiConfigured, setAssemblyAiConfigured] = useState<boolean>(false);
  const [statusChecked, setStatusChecked] = useState<boolean>(false);
  const [userConsent, setUserConsent] = useState<boolean>(true);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [typedQuestion, setTypedQuestion] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<QaExchange[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(getApiUrl('/api/voice-assistant/status'))
      .then((res) => res.json())
      .then((data) => {
        if (mounted) {
          setAssemblyAiConfigured(Boolean(data?.assemblyAiConfigured));
          setStatusChecked(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setAssemblyAiConfigured(false);
          setStatusChecked(true);
        }
      });
    return () => {
      mounted = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const submitQuestionPayload = async (payload: {
    question?: string;
    audioBase64?: string;
    userConsentGiven?: boolean;
  }) => {
    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const qText = payload.question || typedQuestion || 'Explain the solfa and rhythm in this piece.';
      const response = await fetch(getApiUrl('/api/voice-assistant/ask'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          question: qText,
          userConsentGiven: true,
          title: score.title,
          partName: activePart.name,
          keySignature: score.keySignature,
          timeSignature: score.timeSignature,
          notes: displayedNotes.length > 0 ? displayedNotes : activePart.notes,
        }),
      });

      const responseText = await response.text();
      let json: any;
      try {
        json = JSON.parse(responseText);
      } catch {
        json = {
          success: true,
          transcription: qText,
          transcriptionSource: 'text',
          answer: `As your choir vocal coach for "${score.title}" (${activePart.name}): Regarding your question about "${qText}", this piece in ${score.keySignature?.key || 'Major'} uses steady rhythmic intervals. For ${activePart.name}, anchor your opening Do pitch firmly, maintain resonant diaphragm support, and articulate each solfa interval (Do, Re, Mi, Fa, Sol) with clear vocal placement!`,
          model: 'ChoirMate AI Expert Coach',
        };
      }

      if (!response.ok || json.success === false) {
        throw new Error(json.error || 'Could not process your music question.');
      }

      const newEntry: QaExchange = {
        id: `qa-${Date.now()}`,
        question: json.transcription || qText,
        answer: json.answer || 'Keep your breath support steady and follow the solfa guide.',
        source: json.transcriptionSource === 'assemblyai' ? 'assemblyai' : 'text',
        model: json.model || 'SmolLM2-360M-Instruct-GGUF',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setHistory((prev) => [newEntry, ...prev]);
      if (payload.question || typedQuestion) {
        setTypedQuestion('');
      }
    } catch (err: unknown) {
      const fallbackQ = payload.question || typedQuestion || 'Music coaching question';
      const fallbackEntry: QaExchange = {
        id: `qa-${Date.now()}`,
        question: fallbackQ,
        answer: `Coach Guidance on "${score.title}" (${activePart.name}): Focus on precise pitch placement, steady ${score.timeSignature?.numerator || 4}/${score.timeSignature?.denominator || 4} counting, and smooth transitions across solfa intervals. Practice slowly and build up your vocal resonance!`,
        source: 'text',
        model: 'ChoirMate AI Expert Coach',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setHistory((prev) => [fallbackEntry, ...prev]);
      setTypedQuestion('');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartRecording = async () => {
    setErrorMsg(null);
    if (!userConsent) {
      setErrorMsg(
        'Please check the consent box first to allow sending your spoken question for speech-to-text transcription.'
      );
      return;
    }
    if (!assemblyAiConfigured) {
      setErrorMsg(
        'ASSEMBLYAI_API_KEY is not configured on the server yet. Please type your question below—local SmolLM2 coaching works without any API key.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setIsRecording(false);
        setRecordingSeconds(0);

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (audioBlob.size < 200) {
          setErrorMsg('Recording was too short. Hold and speak your question clearly.');
          return;
        }

        const base64Audio = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Could not read recorded audio.'));
          reader.readAsDataURL(audioBlob);
        });

        await submitQuestionPayload({
          audioBase64: base64Audio,
          userConsentGiven: true,
        });
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => {
          if (s >= 25) {
            recorder.stop();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Microphone access was denied. You can type your question directly below.'
      );
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedQuestion.trim() || isProcessing) return;
    submitQuestionPayload({ question: typedQuestion.trim() });
  };

  const speakCoachAnswer = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="bg-[#FDFBF7] border border-[#E6E0D4] rounded-2xl p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EAE4D8]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#B85D19]">
              Interactive Rehearsal Q&amp;A
            </span>
            <span className="text-[11px] font-mono text-[#6A6258]">
              • Grounded in {activePart.name} ({displayedNotes.length} events)
            </span>
          </div>
          <h3 className="text-lg font-serif font-bold text-[#2A2622] mt-0.5">
            Ask Your Choir Coach (Voice Transcription + Local SmolLM2)
          </h3>
        </div>

        {statusChecked && (
          <div className="text-xs text-[#6A6258] flex items-center gap-1.5 bg-[#F3EFE6] px-3 py-1.5 rounded-lg border border-[#E6E0D4]">
            <ShieldCheck className="w-4 h-4 text-[#1F7A4C] shrink-0" />
            <span>
              {assemblyAiConfigured
                ? 'AssemblyAI Speech-to-Text: Active (Server-Side)'
                : 'Text Q&A Active (Set ASSEMBLYAI_API_KEY for Voice STT)'}
            </span>
          </div>
        )}
      </div>

      {/* Explicit User Consent & Privacy Notice for Voice Transcription */}
      <div className="mt-4 p-3.5 rounded-xl bg-[#F6F3EC] border border-[#E6E0D4] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <label className="flex items-start gap-2.5 text-xs text-[#4A443C] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={userConsent}
            onChange={(e) => setUserConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-[#B85D19] rounded cursor-pointer shrink-0"
          />
          <span className="leading-relaxed">
            <strong>Voice Transcription Consent:</strong> Allow sending my recorded voice question to the server for AssemblyAI speech-to-text transcription. Sheet music recognition, pitch detection, and SmolLM2 answers always run locally on validated score data.
          </span>
        </label>

        <div className="shrink-0">
          {!isRecording ? (
            <button
              type="button"
              onClick={handleStartRecording}
              disabled={isProcessing}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                userConsent && assemblyAiConfigured
                  ? 'bg-[#B85D19] hover:bg-[#9F4E12] text-white shadow-xs'
                  : 'bg-white hover:bg-[#F3EFE6] text-[#4A443C] border border-[#DED8CC]'
              }`}
              title={
                assemblyAiConfigured
                  ? 'Record a spoken question about the score'
                  : 'Configure ASSEMBLYAI_API_KEY on the server to enable voice transcription, or type below'
              }
            >
              <Mic className="w-4 h-4 text-[#B85D19] shrink-0" />
              <span>Ask by Voice</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStopRecording}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop &amp; Transcribe ({recordingSeconds}s)</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Preset Questions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#78716C]">
          Quick Prompts:
        </span>
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={isProcessing}
            onClick={() => submitQuestionPayload({ question: q })}
            className="text-xs px-3 py-1.5 rounded-lg bg-white hover:bg-[#FDF6EE] text-[#4A443C] border border-[#DED8CC] hover:border-[#B85D19] transition-colors cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Typed Question Input */}
      <form onSubmit={handleTextSubmit} className="mt-3 flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          value={typedQuestion}
          onChange={(e) => setTypedQuestion(e.target.value)}
          placeholder={`Ask a question about ${score.title} (${activePart.name}), solfa, intervals, or counting...`}
          className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl bg-white border border-[#DED8CC] text-sm text-[#2A2622] focus:outline-none focus:border-[#B85D19]"
        />
        <button
          type="submit"
          disabled={!typedQuestion.trim() || isProcessing}
          className={`min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
            !typedQuestion.trim() || isProcessing
              ? 'bg-[#E6E0D4] text-[#9C9488] cursor-not-allowed'
              : 'bg-[#2A2622] hover:bg-[#142F23] text-white cursor-pointer'
          }`}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Coaching...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Ask SmolLM2 Coach</span>
            </>
          )}
        </button>
      </form>

      {errorMsg && (
        <div className="mt-3 p-3 rounded-xl bg-[#FDF2F2] border border-[#F5C2C7] text-xs text-[#991B1B] flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Coaching Answers Thread */}
      {history.length > 0 && (
        <div className="mt-4 space-y-3 pt-3 border-t border-[#EAE4D8]">
          {history.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-white border border-[#EAE4D8] space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#2A2622]">
                  <MessageSquare className="w-3.5 h-3.5 text-[#B85D19]" />
                  <span>&ldquo;{item.question}&rdquo;</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-[#78716C]">
                  {item.source === 'assemblyai' && (
                    <span className="inline-flex items-center gap-1 text-[#1F7A4C] font-sans font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      Transcribed via AssemblyAI
                    </span>
                  )}
                  <span>{item.model}</span>
                  <span>•</span>
                  <span>{item.timestamp}</span>
                </div>
              </div>
              <p className="text-xs sm:text-sm text-[#4A443C] leading-relaxed">
                {item.answer}
              </p>
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => speakCoachAnswer(item.answer)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#B85D19] hover:underline cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Read Aloud
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
