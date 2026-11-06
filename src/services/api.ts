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
  simulatedDelaySeconds?: number;
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

export type AnalysisJobState = 'queued' | 'processing' | 'completed' | 'failed';

export interface AnalyzeJobStatusResponse {
  success: boolean;
  jobId?: string;
  status?: AnalysisJobState;
  elapsedSeconds?: number;
  message?: string;
  data?: ScoreAnalysis;
  source?: string;
  errorCode?: string;
  error?: string;
  sectionDiagnostics?: SectionDiagnostic[];
  omrAttempted?: boolean;
  recognitionEngine?: string;
}

export type AnalysisProgressCallback = (
  status: 'queued' | 'processing',
  elapsedSeconds: number,
  message?: string
) => void;

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      return reject(abortErr);
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      reject(abortErr);
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function analyzeUploadedScoreSynchronously(
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

function restoreLocalImagesIntoScore(
  score: ScoreAnalysis,
  payload: AnalyzeSheetPayload
): ScoreAnalysis {
  const existingPages =
    Array.isArray(score.pageImages) && score.pageImages.length > 0
      ? score.pageImages
      : undefined;
  const localPages =
    Array.isArray(payload.pages) && payload.pages.length > 0
      ? payload.pages
      : payload.imageBase64
      ? [payload.imageBase64]
      : undefined;

  const finalPageImages = existingPages || localPages;
  const finalImageUrl =
    score.imageUrl ||
    (finalPageImages && finalPageImages.length > 0 ? finalPageImages[0] : undefined);

  return {
    ...score,
    ...(finalPageImages ? { pageImages: finalPageImages } : {}),
    ...(finalImageUrl ? { imageUrl: finalImageUrl } : {}),
  };
}

/**
 * Analyzes an uploaded score (MusicXML, Image, or PDF) via the Python music-processing engine.
 * - Image & PDF scores use asynchronous job submission (`/api/analyze-sheet/start`) and
 *   2-second status polling (`/api/analyze-sheet/status?jobId=...`) so long-running HOMR
 *   recognition never hits Vercel's 55-second proxy timeout.
 * - MusicXML scores use the fast synchronous `/api/analyze-sheet` route (unless simulatedDelaySeconds is set).
 * - NEVER falls back to built-in demonstration music when analyzing user uploads.
 */
export async function analyzeUploadedScore(
  payload: AnalyzeSheetPayload,
  signal?: AbortSignal,
  onProgress?: AnalysisProgressCallback
): Promise<AnalyzeSheetResult> {
  const isImageOrPdf = Boolean(
    payload.pdfBase64 ||
      payload.imageBase64 ||
      (Array.isArray(payload.pages) && payload.pages.length > 0)
  );
  const useAsyncJobFlow = isImageOrPdf || typeof payload.simulatedDelaySeconds === 'number';

  if (!useAsyncJobFlow) {
    const syncRes = await analyzeUploadedScoreSynchronously(payload, signal);
    if (syncRes.data) {
      syncRes.data = restoreLocalImagesIntoScore(syncRes.data, payload);
    }
    return syncRes;
  }

  // 1. Start the asynchronous recognition job
  const startRes = await fetch(getApiUrl('/api/analyze-sheet/start'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
    cache: 'no-store',
    body: JSON.stringify(payload),
    signal,
  });

  // Compatibility fallback if talking to an older server without /analyze-sheet/start
  if (startRes.status === 404) {
    const syncRes = await analyzeUploadedScoreSynchronously(payload, signal);
    if (syncRes.data) {
      syncRes.data = restoreLocalImagesIntoScore(syncRes.data, payload);
    }
    return syncRes;
  }

  const startJson: AnalyzeJobStatusResponse = await startRes.json().catch(() => ({
    success: false,
    errorCode: 'INVALID_START_RESPONSE',
    error: `Failed to start score recognition job (HTTP ${startRes.status}).`,
  }));

  if (!startRes.ok || !startJson.success || !startJson.jobId) {
    throw new ChoirMateApiError(
      startJson.error || 'Could not start score recognition job on the Python backend.',
      startRes.status,
      startJson.errorCode,
      startJson.sectionDiagnostics
    );
  }

  // If the start endpoint returned completed data immediately
  if (startJson.status === 'completed' && startJson.data) {
    return {
      success: true,
      data: restoreLocalImagesIntoScore(startJson.data, payload),
      source: startJson.source,
    };
  }

  const jobId = startJson.jobId;
  if (onProgress) {
    onProgress(
      startJson.status === 'processing' ? 'processing' : 'queued',
      0,
      startJson.message
    );
  }

  // 2. Poll every ~2 seconds until completed or failed (up to 10 minutes max)
  const pollIntervalMs = 2000;
  const maxPolls = 300;
  let consecutiveNetworkErrors = 0;

  for (let attempt = 0; attempt < maxPolls; attempt++) {
    await waitWithAbort(pollIntervalMs, signal);

    let statusRes: Response;
    try {
      statusRes = await fetch(
        getApiUrl(`/api/analyze-sheet/status?jobId=${encodeURIComponent(jobId)}`),
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
          cache: 'no-store',
          signal,
        }
      );
    } catch (netErr: any) {
      if (netErr?.name === 'AbortError') {
        throw netErr;
      }
      consecutiveNetworkErrors++;
      if (consecutiveNetworkErrors >= 4) {
        throw new ChoirMateApiError(
          'Lost network connection while waiting for score recognition to complete. Please check your connection and try again.',
          503,
          'NETWORK_INTERRUPTED'
        );
      }
      continue;
    }

    const statusJson: AnalyzeJobStatusResponse = await statusRes.json().catch(() => ({
      success: false,
      errorCode: 'INVALID_STATUS_RESPONSE',
      error: `Invalid status response from recognition server (HTTP ${statusRes.status}).`,
    }));

    // Handle transient 502/503/504 gateway blips up to 3 times before aborting
    if (statusRes.status === 502 || statusRes.status === 503 || statusRes.status === 504) {
      consecutiveNetworkErrors++;
      if (consecutiveNetworkErrors >= 4) {
        throw new ChoirMateApiError(
          statusJson.error ||
            'The Python HOMR recognition service became unreachable while processing your score.',
          statusRes.status,
          statusJson.errorCode || 'HOMR_ENVIRONMENT_REQUIRED'
        );
      }
      continue;
    }

    consecutiveNetworkErrors = 0;

    if (statusRes.status === 404 || statusJson.errorCode === 'JOB_NOT_FOUND') {
      throw new ChoirMateApiError(
        statusJson.error ||
          'The active recognition job was lost because the Python service restarted. Please click Analyze again.',
        404,
        'JOB_NOT_FOUND'
      );
    }

    if (statusRes.status === 401 || statusRes.status === 403) {
      throw new ChoirMateApiError(
        statusJson.error || 'Unauthorized request to the Python recognition service.',
        statusRes.status,
        statusJson.errorCode || 'UNAUTHORIZED_PYTHON_CLIENT'
      );
    }

    if (statusJson.status === 'queued' || statusJson.status === 'processing') {
      if (onProgress) {
        onProgress(
          statusJson.status,
          Number(statusJson.elapsedSeconds || (attempt + 1) * 2),
          statusJson.message
        );
      }
      continue;
    }

    if (statusJson.status === 'completed' && statusJson.success && statusJson.data) {
      return {
        success: true,
        data: restoreLocalImagesIntoScore(statusJson.data, payload),
        source: statusJson.source,
      };
    }

    if (statusJson.status === 'failed' || !statusRes.ok || !statusJson.success) {
      throw new ChoirMateApiError(
        statusJson.error || 'Score recognition could not extract valid musical notes from the file.',
        statusRes.ok ? 422 : statusRes.status,
        statusJson.errorCode || 'OMR_RECOGNITION_FAILED',
        statusJson.sectionDiagnostics
      );
    }
  }

  throw new ChoirMateApiError(
    'Score recognition timed out after 10 minutes. Please try uploading fewer pages at a time.',
    504,
    'JOB_POLL_TIMEOUT'
  );
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
