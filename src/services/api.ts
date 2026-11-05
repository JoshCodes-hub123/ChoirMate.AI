import { getApiUrl } from '../utils/apiConfig';
import {
  ExportAudioResponse,
  HealthStatus,
  MusicNote,
  PdfPreviewResponse,
  ScoreAnalysis,
  SectionDiagnostic,
  VoiceAudioResponse,
  VoiceExtractionResponse,
  VoiceStudioVoice,
} from '../types/music';

export interface AnalyzeSheetPayload {
  imageBase64?: string;
  pages?: string[];
  pdfBase64?: string;
  pdfFileName?: string;
  musicxml?: string;
  sampleId?: string;
  title?: string;
  composer?: string;
  tempo?: number;
}

export interface AnalyzeSheetResult {
  success: boolean;
  data?: ScoreAnalysis;
  source?: string;
  errorCode?: string;
  error?: string;
  sectionDiagnostics?: SectionDiagnostic[];
  omrAttempted?: boolean;
  recognitionEngine?: string;
}

export interface RecalculateScorePayload {
  score: ScoreAnalysis;
  partId?: string;
  updatedNotes: MusicNote[];
  fifths?: number;
}

export interface RecalculateScoreResult {
  success: boolean;
  data?: ScoreAnalysis;
  errorCode?: string;
  error?: string;
}

export interface ExportAudioPayload {
  notes: MusicNote[];
  title: string;
  partName: string;
  scopeLabel?: string;
  tempo: number;
  voice: string;
  format: 'mp3' | 'wav';
  metronome: boolean;
}

export class ChoirMateApiError extends Error {
  public readonly status: number;
  public readonly errorCode?: string;
  public readonly diagnostics?: SectionDiagnostic[];

  constructor(
    message: string,
    status = 500,
    errorCode?: string,
    diagnostics?: SectionDiagnostic[]
  ) {
    super(message);
    this.name = 'ChoirMateApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.diagnostics = diagnostics;
  }
}

export async function fetchHealthStatus(signal?: AbortSignal): Promise<HealthStatus> {
  const response = await fetch(getApiUrl('/api/health'), { signal });
  if (!response.ok) {
    throw new ChoirMateApiError(`Health check failed (HTTP ${response.status})`, response.status);
  }
  return response.json();
}

export async function previewPdfDocument(
  pdfBase64: string,
  fileName: string,
  signal?: AbortSignal
): Promise<PdfPreviewResponse> {
  const response = await fetch(getApiUrl('/api/preview-pdf'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfBase64, fileName }),
    signal,
  });

  const json: PdfPreviewResponse = await response.json().catch(() => ({
    success: false,
    error: `PDF preview request failed with status ${response.status}.`,
  }));

  if (!response.ok || !json.success) {
    throw new ChoirMateApiError(
      json.error || 'Could not render PDF pages.',
      response.status,
      json.errorCode
    );
  }

  return json;
}

/**
 * Analyzes an uploaded score (MusicXML, Image, or PDF) via the Python music-processing engine.
 * NEVER falls back to built-in demonstration music when analyzing user uploads.
 */
export async function analyzeUploadedScore(
  payload: AnalyzeSheetPayload,
  signal?: AbortSignal
): Promise<AnalyzeSheetResult> {
  const response = await fetch(getApiUrl('/api/analyze-sheet'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const json: AnalyzeSheetResult = await response.json().catch(() => ({
    success: false,
    errorCode: 'INVALID_SERVER_RESPONSE',
    error: `Backend returned non-JSON response (HTTP ${response.status}).`,
  }));

  if (!response.ok || !json.success || !json.data) {
    throw new ChoirMateApiError(
      json.error || 'Score recognition could not extract valid musical notes from the file.',
      response.status,
      json.errorCode,
      json.sectionDiagnostics
    );
  }

  return json;
}

export async function recalculateScoreAnalysis(
  payload: RecalculateScorePayload,
  signal?: AbortSignal
): Promise<ScoreAnalysis> {
  const response = await fetch(getApiUrl('/api/recalculate-score'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const json: RecalculateScoreResult = await response.json().catch(() => ({
    success: false,
    error: `Recalculation failed (HTTP ${response.status}).`,
  }));

  if (!response.ok || !json.success || !json.data) {
    throw new ChoirMateApiError(
      json.error || 'Failed to recalculate score music theory.',
      response.status,
      json.errorCode
    );
  }

  return json.data;
}

export async function extractVoicesFromMusicXml(
  musicxml: string,
  signal?: AbortSignal
): Promise<VoiceStudioVoice[]> {
  const response = await fetch(getApiUrl('/api/voice-studio/voices'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ musicxml }),
    signal,
  });

  const json: VoiceExtractionResponse = await response.json().catch(() => ({
    success: false,
    errorCode: 'INVALID_VOICE_RESPONSE',
    error: `Voice extraction returned invalid response (HTTP ${response.status}).`,
  }));

  if (!response.ok || !json.success || !Array.isArray(json.voices)) {
    throw new ChoirMateApiError(
      json.error || 'Could not extract vocal parts from the provided MusicXML.',
      response.status,
      json.errorCode
    );
  }

  return json.voices;
}

export async function synthesizeVoiceStudioAudio(
  musicxml: string,
  selectedVoiceIds: string[],
  tempo: number,
  signal?: AbortSignal
): Promise<VoiceAudioResponse> {
  const response = await fetch(getApiUrl('/api/voice-studio/audio'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      musicxml,
      selectedVoiceIds,
      tempo,
    }),
    signal,
  });

  const json: VoiceAudioResponse = await response.json().catch(() => ({
    success: false,
    errorCode: 'INVALID_AUDIO_RESPONSE',
    error: `Voice audio synthesis failed (HTTP ${response.status}).`,
  }));

  if (!response.ok || !json.success || !json.audioBase64) {
    throw new ChoirMateApiError(
      json.error || 'Failed to synthesize synchronized SATB rehearsal audio.',
      response.status,
      json.errorCode
    );
  }

  return json;
}

export async function exportPracticeAudioFromBackend(
  payload: ExportAudioPayload,
  signal?: AbortSignal
): Promise<ExportAudioResponse> {
  const response = await fetch(getApiUrl('/api/export-audio'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  const json: ExportAudioResponse = await response.json().catch(() => ({
    success: false,
    errorCode: 'EXPORT_HTTP_ERROR',
    error: `Audio export service returned HTTP ${response.status}.`,
  }));

  if (!response.ok || !json.success || !json.audioBase64) {
    throw new ChoirMateApiError(
      json.error || 'Python audio exporter could not synthesize the requested practice audio.',
      response.status,
      json.errorCode
    );
  }

  return json;
}
