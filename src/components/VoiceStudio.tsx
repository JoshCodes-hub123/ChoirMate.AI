
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  Download,
  LoaderCircle,
  Music2,
  RefreshCw,
} from 'lucide-react';
import type { ScoreAnalysis } from '../types/music';
import { generateMusicXml } from '../utils/musicXmlExport';
import { getApiUrl } from '../utils/apiConfig';

interface Voice {
  id: string;
  name: string;
}

interface VoiceStudioProps {
  score: ScoreAnalysis;
  onBackToLearn: () => void;
}

interface VoiceResponse {
  success: boolean;
  voices?: Array<Record<string, unknown>>;
  error?: string;
}

interface AudioResponse {
  success: boolean;
  audioBase64?: string;
  mimeType?: string;
  durationSeconds?: number;
  error?: string;
}

const voiceLabel = (voice: Record<string, unknown>, index: number): Voice => ({
  id: String(voice.id ?? voice.partId ?? `P${index + 1}`),
  name: String(voice.name ?? voice.label ?? `Voice ${index + 1}`),
});

export const VoiceStudio: React.FC<VoiceStudioProps> = ({
  score,
  onBackToLearn,
}) => {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tempo, setTempo] = useState(88);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [duration, setDuration] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef(0);

  const musicxml = React.useMemo(() => generateMusicXml(score), [score]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const loadVoices = async () => {
      setLoadingVoices(true);
      setError('');
      setVoices([]);
      setSelectedIds([]);

      try {
        const response = await fetch(getApiUrl('/api/voice-studio/voices'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ musicxml }),
          signal: controller.signal,
        });

        const data: VoiceResponse = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Unable to identify voices in this score.');
        }

        const available = (data.voices || []).map(voiceLabel);

        if (active) {
          setVoices(available);
          setSelectedIds(available.map((voice) => voice.id));

          if (!available.length) {
            setError('No playable voices were detected in this score.');
          }
        }
      } catch (err) {
        if (active && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Voice detection failed.');
        }
      } finally {
        if (active) setLoadingVoices(false);
      }
    };

    void loadVoices();

    return () => {
      active = false;
      controller.abort();
    };
  }, [musicxml]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const clearAudio = () => {
    requestRef.current += 1;
    audioRef.current?.pause();
    setAudioUrl('');
    setDuration(null);
  };

  const toggleVoice = (id: string) => {
    clearAudio();
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id]
    );
  };

  const selectAll = () => {
    clearAudio();
    setSelectedIds(voices.map((voice) => voice.id));
  };

  const generateAudio = async () => {
    if (!selectedIds.length || generating) return;

    const requestId = ++requestRef.current;
    setGenerating(true);
    setError('');
    setAudioUrl('');
    setDuration(null);

    try {
      const response = await fetch(getApiUrl('/api/voice-studio/audio'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          musicxml,
          selectedVoiceIds: selectedIds,
          tempo,
        }),
      });

      const data: AudioResponse = await response.json();

      if (!response.ok || !data.success || !data.audioBase64) {
        throw new Error(data.error || 'Audio generation failed.');
      }

      const binary = atob(data.audioBase64);
      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([bytes], {
        type: data.mimeType || 'audio/wav',
      });

      const url = URL.createObjectURL(blob);

      if (requestId !== requestRef.current) {
        URL.revokeObjectURL(url);
        return;
      }

      setAudioUrl(url);
      setDuration(data.durationSeconds ?? null);
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : 'Could not generate audio.');
      }
    } finally {
      if (requestId === requestRef.current) {
        setGenerating(false);
      }
    }
  };

  const downloadAudio = () => {
    if (!audioUrl) return;

    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = 'choirmate-rehearsal.wav';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="max-w-5xl mx-auto space-y-7 pb-12">
      <button
        type="button"
        onClick={onBackToLearn}
        className="inline-flex items-center gap-2 text-sm text-[#526359] hover:text-[#143826]"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to score
      </button>

      <section className="rounded-3xl bg-[#143826] text-white p-6 sm:p-10">
        <div className="flex items-center gap-2 text-[#E2C77D] text-xs font-semibold uppercase tracking-[0.2em]">
          <AudioLines className="w-4 h-4" />
          ChoirMate AI
        </div>

        <h1 className="font-serif text-3xl sm:text-5xl mt-4">
          Your Voice Studio
        </h1>

        <p className="text-[#D8E4DB] text-sm sm:text-base mt-3 max-w-xl leading-relaxed">
          Hear your part. Understand your harmony. Rehearse with confidence.
        </p>

        <div className="mt-7 flex items-center gap-2 text-sm text-[#E2C77D]">
          <Music2 className="w-4 h-4" />
          <span className="truncate">{score.title || 'Untitled score'}</span>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6">
        <section className="bg-white rounded-3xl border border-[#E8E0D0] p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="font-serif text-2xl text-[#143826]">
                Choose your voices
              </h2>
              <p className="text-sm text-[#637269] mt-1">
                Select one part or combine multiple voices.
              </p>
            </div>

            <button
              type="button"
              onClick={selectAll}
              disabled={loadingVoices || !voices.length}
              className="text-xs font-semibold text-[#9E7B35] disabled:opacity-40"
            >
              Select all
            </button>
          </div>

          {loadingVoices ? (
            <div className="flex items-center gap-3 py-8 text-sm text-[#637269]">
              <LoaderCircle className="w-5 h-5 animate-spin" />
              Reading vocal parts...
            </div>
          ) : (
            <div className="space-y-3">
              {voices.map((voice) => {
                const selected = selectedIds.includes(voice.id);

                return (
                  <button
                    key={voice.id}
                    type="button"
                    onClick={() => toggleVoice(voice.id)}
                    aria-pressed={selected}
                    className={`w-full flex items-center justify-between gap-3 p-4 rounded-2xl border text-left transition-colors ${
                      selected
                        ? 'border-[#143826] bg-[#EDF3ED]'
                        : 'border-[#E8E0D0] bg-[#FCFAF7] hover:border-[#9DAE9F]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#143826]/10 text-[#143826] flex items-center justify-center">
                        <Music2 className="w-5 h-5" />
                      </span>

                      <span className="font-semibold text-[#143826]">
                        {voice.name}
                      </span>
                    </div>

                    <span
                      className={`w-6 h-6 rounded-full border flex items-center justify-center ${
                        selected
                          ? 'bg-[#143826] border-[#143826] text-white'
                          : 'border-[#B6C2B8]'
                      }`}
                    >
                      {selected && <Check className="w-4 h-4" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-xs text-[#637269] mt-5">
            {selectedIds.length} of {voices.length} voices selected
          </p>
        </section>

        <section className="bg-white rounded-3xl border border-[#E8E0D0] p-5 sm:p-7 flex flex-col">
          <h2 className="font-serif text-2xl text-[#143826]">
            Rehearsal settings
          </h2>

          <p className="text-sm text-[#637269] mt-1">
            Practise slowly or build up to performance speed.
          </p>

          <div className="mt-8 flex-1">
            <div className="flex justify-between items-center">
              <label htmlFor="voice-studio-tempo" className="text-sm font-semibold text-[#143826]">
                Tempo
              </label>
              <span className="text-sm font-semibold text-[#9E7B35]">
                {tempo} BPM
              </span>
            </div>

            <input
              id="voice-studio-tempo"
              type="range"
              min={36}
              max={220}
              step={2}
              value={tempo}
              onChange={(event) => {
                clearAudio();
                setTempo(Number(event.target.value));
              }}
              className="w-full mt-5 accent-[#143826]"
            />

            <div className="flex justify-between text-xs text-[#637269] mt-2">
              <span>Slow</span>
              <span>Fast</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void generateAudio()}
            disabled={loadingVoices || generating || !selectedIds.length}
            className="w-full mt-8 min-h-[52px] rounded-full bg-[#143826] hover:bg-[#1E5037] text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? (
              <>
                <LoaderCircle className="w-5 h-5 animate-spin" />
                Preparing rehearsal...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Generate rehearsal audio
              </>
            )}
          </button>
        </section>
      </div>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {audioUrl && (
        <section className="bg-white rounded-3xl border border-[#E8E0D0] p-5 sm:p-7 space-y-5">
          <div>
            <h2 className="font-serif text-2xl text-[#143826]">
              Your rehearsal is ready
            </h2>
            <p className="text-sm text-[#637269] mt-1">
              {duration !== null
                ? `${duration.toFixed(1)} seconds of synchronized rehearsal audio`
                : 'Listen to your selected voices.'}
            </p>
          </div>

          <audio
            ref={audioRef}
            controls
            src={audioUrl}
            className="w-full"
            aria-label="ChoirMate rehearsal audio"
          />

          <button
            type="button"
            onClick={downloadAudio}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 rounded-full border border-[#143826] text-[#143826] hover:bg-[#EDF3ED] text-sm font-semibold"
          >
            <Download className="w-4 h-4" />
            Download WAV
          </button>
        </section>
      )}
    </div>
  );
};
