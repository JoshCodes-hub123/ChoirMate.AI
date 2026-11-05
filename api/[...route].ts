/**
 * ChoirMate AI — Vercel Serverless API Gateway (/api/[...route].ts)
 *
 * Allows the public Vercel web application to securely proxy API requests to
 * the external Python HOMR + MusicXML + SATB + Audio Synthesis server (such as
 * a Windows laptop running `python/service.py` behind a permanent Cloudflare Tunnel
 * or static ngrok HTTPS domain) using server-side environment variables
 * (`PYTHON_SERVICE_URL` and `PYTHON_SERVICE_SECRET`).
 *
 * Private tunnel URLs and backend credentials are never exposed to the browser.
 */

const FRIENDLY_HOMR_UNAVAILABLE_MESSAGE =
  'Sheet music image and PDF recognition is temporarily unavailable because the HOMR Optical Music Recognition engine is currently offline. You can still upload MusicXML (.musicxml or .xml) files for full note analysis, SATB voice extraction, and practice audio generation.';

// Keep upstream fetch timeouts safely below Vercel's 60s maxDuration so our
// function always returns a structured JSON error instead of an unhandled 504 crash.
const VERCEL_MAX_UPSTREAM_TIMEOUT_MS = Number(process.env.VERCEL_PROXY_TIMEOUT_MS) || 55000;

function getPythonServiceUrl(): string {
  const raw =
    process.env.PYTHON_SERVICE_URL ||
    process.env.PYTHON_BACKEND_URL ||
    '';
  return raw.trim().replace(/\/+$/, '');
}

function getPythonServiceSecret(): string {
  return (
    process.env.PYTHON_SERVICE_SECRET ||
    process.env.CHOIRMATE_BACKEND_SECRET ||
    ''
  ).trim();
}

function buildPythonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  const secret = getPythonServiceSecret();
  if (secret) {
    headers['X-ChoirMate-Secret'] = secret;
    headers['Authorization'] = `Bearer ${secret}`;
  }
  return headers;
}

/**
 * Resolves the normalized sub-route path (e.g. '/health', '/analyze-sheet',
 * '/voice-studio/voices') across both native Vercel catch-all routing (`req.query.route`)
 * and rewritten URLs (`/api/[...route]?route=...` or `/api/voice-studio/voices`).
 */
export function resolveApiPathname(req: any): string {
  const rawUrl: string = typeof req?.url === 'string' ? req.url : '';
  const [rawPath, rawQueryString = ''] = rawUrl.split('?');
  const strippedPath = rawPath.replace(/^\/api\/?/, '');

  if (
    strippedPath &&
    strippedPath !== '[...route]' &&
    !strippedPath.startsWith('[...route]')
  ) {
    return '/' + strippedPath.replace(/^\/+/, '');
  }

  const routeParam = req?.query?.route;
  if (Array.isArray(routeParam) && routeParam.length > 0) {
    return '/' + routeParam.map((seg) => String(seg).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  }
  if (typeof routeParam === 'string' && routeParam.trim()) {
    return '/' + routeParam.trim().replace(/^\/+/, '');
  }

  if (rawQueryString) {
    const params = new URLSearchParams(rawQueryString);
    const fromQuery = params.get('route');
    if (fromQuery && fromQuery.trim()) {
      return '/' + fromQuery.trim().replace(/^\/+/, '');
    }
  }

  return '/health';
}

function isBinaryDownloadRequested(req: any): boolean {
  if (req?.query?.binary === '1' || req?.query?.binary === 'true') {
    return true;
  }
  const rawUrl: string = typeof req?.url === 'string' ? req.url : '';
  const queryPart = rawUrl.split('?')[1] || '';
  if (!queryPart) return false;
  const params = new URLSearchParams(queryPart);
  return params.get('binary') === '1' || params.get('binary') === 'true';
}

function parseRequestBody(req: any): { ok: true; body: Record<string, any> } | { ok: false; error: string } {
  if (!req?.body) {
    return { ok: true, body: {} };
  }
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return { ok: true, body: req.body };
  }
  try {
    const rawStr = Buffer.isBuffer(req.body) ? req.body.toString('utf-8') : String(req.body);
    return { ok: true, body: rawStr.trim() ? JSON.parse(rawStr) : {} };
  } catch {
    return { ok: false, error: 'Invalid JSON request payload.' };
  }
}

async function parseUpstreamResponse(pyRes: Response): Promise<{
  isJson: boolean;
  json: any;
  rawBuffer: Buffer | null;
  contentType: string;
}> {
  const contentType = (pyRes.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      const json = await pyRes.json();
      return { isJson: true, json, rawBuffer: null, contentType };
    } catch {
      return { isJson: false, json: null, rawBuffer: null, contentType };
    }
  }
  if (contentType.startsWith('audio/') || contentType.includes('application/octet-stream')) {
    const ab = await pyRes.arrayBuffer();
    return { isJson: false, json: null, rawBuffer: Buffer.from(ab), contentType };
  }
  const text = await pyRes.text();
  try {
    const json = JSON.parse(text);
    return { isJson: true, json, rawBuffer: null, contentType: 'application/json' };
  } catch {
    return { isJson: false, json: { error: text.slice(0, 300) }, rawBuffer: null, contentType };
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const pathname = resolveApiPathname(req);
  const pythonBaseUrl = getPythonServiceUrl();
  const hasSecretConfigured = Boolean(getPythonServiceSecret());

  // 1. GET /api/health
  if (pathname === '/health') {
    if (!pythonBaseUrl) {
      return res.status(200).json({
        status: 'ok',
        openWeight: true,
        pythonServiceActive: false,
        pythonBackendMode: 'remote',
        pythonAuthConfigured: hasSecretConfigured,
        pythonAuthStatus: hasSecretConfigured ? 'unverified' : 'unconfigured',
        modelLoaded: false,
        omrAvailable: false,
        omrEngineStatus: 'backend_offline',
        missingOmrDependencies: [],
        pdfSupport: false,
        musicXmlSupport: false,
        voiceStudioAvailable: false,
        audioExportAvailable: false,
        pythonServiceUrl: '[unconfigured]',
        pythonHost: 'remote',
        pythonPort: 5001,
        recognitionEngine: 'HOMR (Full-Score Optical Music Recognition)',
        aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
        modelLicense: 'Apache 2.0',
        sampleScoresCount: 6,
      });
    }

    try {
      const pyRes = await fetch(`${pythonBaseUrl}/health`, {
        headers: buildPythonHeaders(),
        signal: AbortSignal.timeout(4500),
      });

      if (pyRes.status === 401 || pyRes.status === 403) {
        return res.status(200).json({
          status: 'ok',
          openWeight: true,
          pythonServiceActive: false,
          pythonBackendMode: 'remote',
          pythonAuthConfigured: hasSecretConfigured,
          pythonAuthStatus: 'unauthorized',
          modelLoaded: false,
          omrAvailable: false,
          omrEngineStatus: 'backend_offline',
          missingOmrDependencies: [],
          pdfSupport: false,
          musicXmlSupport: false,
          voiceStudioAvailable: false,
          audioExportAvailable: false,
          pythonServiceUrl: '[remote-configured]',
          pythonHost: 'remote',
          pythonPort: 5001,
          recognitionEngine: 'HOMR (Full-Score Optical Music Recognition)',
          aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
          modelLicense: 'Apache 2.0',
          sampleScoresCount: 6,
        });
      }

      if (pyRes.ok) {
        const healthData: any = await pyRes.json();
        const omrAvailable = Boolean(healthData?.omrAvailable ?? healthData?.modelLoaded);
        return res.status(200).json({
          status: 'ok',
          openWeight: true,
          pythonServiceActive: true,
          pythonBackendMode: 'remote',
          pythonAuthConfigured: hasSecretConfigured,
          pythonAuthStatus: hasSecretConfigured || healthData?.authRequired ? 'authenticated' : 'unconfigured',
          modelLoaded: Boolean(healthData?.modelLoaded),
          omrAvailable,
          omrEngineStatus: omrAvailable ? 'ready' : 'unavailable_in_environment',
          missingOmrDependencies: Array.isArray(healthData?.missingOmrDependencies)
            ? healthData.missingOmrDependencies
            : [],
          pdfSupport: Boolean(healthData?.pdfSupport),
          musicXmlSupport: healthData?.musicXmlSupport !== false,
          voiceStudioAvailable: healthData?.voiceStudioAvailable !== false,
          audioExportAvailable: healthData?.audioExportAvailable !== false,
          pythonServiceUrl: '[remote-configured]',
          pythonHost: 'remote',
          pythonPort: 5001,
          recognitionEngine: 'HOMR (Full-Score Optical Music Recognition)',
          aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
          modelLicense: 'Apache 2.0',
          sampleScoresCount: 6,
        });
      }
    } catch {
      // Remote service offline
    }

    return res.status(200).json({
      status: 'ok',
      openWeight: true,
      pythonServiceActive: false,
      pythonBackendMode: 'remote',
      pythonAuthConfigured: hasSecretConfigured,
      pythonAuthStatus: 'offline',
      modelLoaded: false,
      omrAvailable: false,
      omrEngineStatus: 'backend_offline',
      missingOmrDependencies: [],
      pdfSupport: false,
      musicXmlSupport: false,
      voiceStudioAvailable: false,
      audioExportAvailable: false,
      pythonServiceUrl: '[remote-configured]',
      pythonHost: 'remote',
      pythonPort: 5001,
      recognitionEngine: 'HOMR (Full-Score Optical Music Recognition)',
      aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
      modelLicense: 'Apache 2.0',
      sampleScoresCount: 6,
    });
  }

  // 2. GET /api/voice-assistant/status
  if (pathname === '/voice-assistant/status') {
    const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
    return res.status(200).json({
      success: true,
      assemblyAiConfigured: Boolean(apiKey),
      provider: 'AssemblyAI Speech-to-Text API',
      teacherModel: 'SmolLM2-360M-Instruct-GGUF (Local Open-Weight)',
      capabilityNotice:
        'AssemblyAI is used strictly for server-side speech-to-text transcription of your spoken music questions after explicit user consent.',
    });
  }

  // Require PYTHON_SERVICE_URL for Python engine POST routes
  if (!pythonBaseUrl) {
    return res.status(503).json({
      success: false,
      errorCode: 'HOMR_ENVIRONMENT_REQUIRED',
      error: FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
    });
  }

  const parsedBody = parseRequestBody(req);
  if (!parsedBody.ok) {
    return res.status(400).json({
      success: false,
      errorCode: 'INVALID_JSON_BODY',
      error: parsedBody.error,
    });
  }
  const body = parsedBody.body;

  // 3. POST /api/analyze-sheet -> ${PYTHON_SERVICE_URL}/analyze
  if (pathname === '/analyze-sheet') {
    const { imageBase64, pages, pdfBase64, pdfFileName, musicxml, title, composer, tempo } = body;
    const pageImages: string[] =
      Array.isArray(pages) && pages.length > 0
        ? pages
        : imageBase64
        ? [imageBase64]
        : [];

    if (pageImages.length === 0 && !pdfBase64 && !musicxml) {
      return res.status(400).json({
        success: false,
        errorCode: 'NO_INPUT_PROVIDED',
        error: 'Please provide a sheet music PDF document, page image(s), or a MusicXML file.',
      });
    }

    try {
      const pyRes = await fetch(`${pythonBaseUrl}/analyze`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify({
          // Avoid sending both imageBase64 and pages simultaneously to save request bandwidth
          imageBase64: pageImages.length === 1 && !pdfBase64 ? pageImages[0] : undefined,
          pages: pageImages.length > 1 && !pdfBase64 ? pageImages : undefined,
          pdfBase64: pdfBase64 || undefined,
          pdfFileName: pdfFileName || undefined,
          musicxml,
          title: title || 'Analyzed Score',
          composer: composer || 'Unknown Composer',
          tempo: tempo || 76,
        }),
        signal: AbortSignal.timeout(VERCEL_MAX_UPSTREAM_TIMEOUT_MS),
      });

      const upstream = await parseUpstreamResponse(pyRes);
      const pyJson = upstream.json || {};

      if (pyRes.status === 401 || pyRes.status === 403) {
        return res.status(pyRes.status).json({
          success: false,
          errorCode: pyJson?.errorCode || 'UNAUTHORIZED_PYTHON_CLIENT',
          error:
            pyJson?.error ||
            'Authentication with the ChoirMate Python engine failed. Please verify PYTHON_SERVICE_SECRET matches on Vercel and your Windows laptop.',
        });
      }

      if (pyRes.ok && pyJson.success && pyJson.data) {
        return res.status(200).json(pyJson);
      }

      return res.status(pyRes.status >= 400 && pyRes.status < 600 ? pyRes.status : 422).json({
        success: false,
        errorCode: pyJson?.errorCode || 'OMR_RECOGNITION_FAILED',
        error: pyJson?.error || FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
        sectionDiagnostics: pyJson?.sectionDiagnostics || [],
        omrAttempted: Boolean(pyJson?.omrAttempted),
        recognitionEngine: 'HOMR',
      });
    } catch (err: any) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return res.status(isTimeout ? 504 : 503).json({
        success: false,
        errorCode: isTimeout ? 'UPSTREAM_TIMEOUT' : 'HOMR_ENVIRONMENT_REQUIRED',
        error: isTimeout
          ? 'The Python HOMR recognition service took longer than the serverless gateway timeout limit (55s). Try uploading a single page or lower-resolution scan.'
          : FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
      });
    }
  }

  // 4. POST /api/preview-pdf -> ${PYTHON_SERVICE_URL}/preview-pdf
  if (pathname === '/preview-pdf') {
    try {
      const pyRes = await fetch(`${pythonBaseUrl}/preview-pdf`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(VERCEL_MAX_UPSTREAM_TIMEOUT_MS, 45000)),
      });
      const upstream = await parseUpstreamResponse(pyRes);
      const pyJson = upstream.json || {};
      if (pyRes.status === 401 || pyRes.status === 403) {
        return res.status(pyRes.status).json({
          success: false,
          errorCode: pyJson?.errorCode || 'UNAUTHORIZED_PYTHON_CLIENT',
          error: pyJson?.error || 'Unauthorized request to ChoirMate Python engine.',
        });
      }
      return res.status(pyRes.ok && pyJson.success ? 200 : 422).json(pyJson);
    } catch {
      return res.status(503).json({
        success: false,
        errorCode: 'PDF_PREVIEW_UNAVAILABLE',
        error: FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
      });
    }
  }

  // 5. POST /api/recalculate-score -> ${PYTHON_SERVICE_URL}/recalculate
  if (pathname === '/recalculate-score') {
    try {
      const pyRes = await fetch(`${pythonBaseUrl}/recalculate`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(VERCEL_MAX_UPSTREAM_TIMEOUT_MS, 45000)),
      });
      const upstream = await parseUpstreamResponse(pyRes);
      const pyJson = upstream.json || {};
      if (pyRes.ok && pyJson.success && pyJson.data && body.score) {
        pyJson.data.imageUrl = body.score.imageUrl;
        pyJson.data.pageImages = body.score.pageImages;
      }
      return res.status(pyRes.status).json(pyJson);
    } catch {
      return res.status(503).json({
        success: false,
        errorCode: 'RECALCULATE_UNAVAILABLE',
        error: 'Python score recalculation service is currently unreachable.',
      });
    }
  }

  // 6. POST /api/export-audio -> ${PYTHON_SERVICE_URL}/export-audio
  if (pathname === '/export-audio') {
    try {
      const requestedFormat = String(body?.format || 'mp3').toLowerCase() === 'wav' ? 'wav' : 'mp3';
      const pyRes = await fetch(`${pythonBaseUrl}/export-audio`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.min(VERCEL_MAX_UPSTREAM_TIMEOUT_MS, 45000)),
      });

      const upstream = await parseUpstreamResponse(pyRes);

      // Direct binary audio response passthrough
      if (upstream.rawBuffer && pyRes.ok) {
        res.setHeader(
          'Content-Type',
          upstream.contentType || (requestedFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav')
        );
        const disp = pyRes.headers.get('content-disposition');
        if (disp) res.setHeader('Content-Disposition', disp);
        res.setHeader('Content-Length', String(upstream.rawBuffer.length));
        return res.status(200).send(upstream.rawBuffer);
      }

      const pyJson = upstream.json || {};

      if (pyRes.ok && pyJson.success && pyJson.audioBase64 && isBinaryDownloadRequested(req)) {
        const audioBuffer = Buffer.from(pyJson.audioBase64, 'base64');
        res.setHeader(
          'Content-Type',
          pyJson.mimeType || (requestedFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav')
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${pyJson.fileName || `practice.${requestedFormat}`}"`
        );
        res.setHeader('Content-Length', String(audioBuffer.length));
        return res.status(200).send(audioBuffer);
      }

      return res.status(pyRes.status).json(pyJson);
    } catch {
      return res.status(503).json({
        success: false,
        errorCode: 'AUDIO_EXPORT_UNAVAILABLE',
        error: 'Python audio export service is currently unreachable.',
      });
    }
  }

  // 7. POST /api/voice-studio/voices & /api/voice-studio/audio
  if (pathname === '/voice-studio/voices' || pathname === '/voice-studio/audio') {
    try {
      const pyRes = await fetch(`${pythonBaseUrl}${pathname}`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(VERCEL_MAX_UPSTREAM_TIMEOUT_MS),
      });

      const upstream = await parseUpstreamResponse(pyRes);

      if (pathname === '/voice-studio/audio' && upstream.rawBuffer && pyRes.ok) {
        res.setHeader('Content-Type', upstream.contentType || 'audio/wav');
        const disp = pyRes.headers.get('content-disposition');
        if (disp) res.setHeader('Content-Disposition', disp);
        res.setHeader('Content-Length', String(upstream.rawBuffer.length));
        return res.status(200).send(upstream.rawBuffer);
      }

      const pyJson = upstream.json || {};

      if (
        pathname === '/voice-studio/audio' &&
        pyRes.ok &&
        pyJson.success &&
        pyJson.audioBase64 &&
        isBinaryDownloadRequested(req)
      ) {
        const audioBuffer = Buffer.from(pyJson.audioBase64, 'base64');
        res.setHeader('Content-Type', pyJson.mimeType || 'audio/wav');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${pyJson.fileName || 'choirmate-satb-rehearsal.wav'}"`
        );
        res.setHeader('Content-Length', String(audioBuffer.length));
        return res.status(200).send(audioBuffer);
      }

      return res.status(pyRes.status).json(pyJson);
    } catch {
      return res.status(503).json({
        success: false,
        errorCode: 'VOICE_STUDIO_UNAVAILABLE',
        error: 'Python Voice Studio service is currently unreachable.',
      });
    }
  }

  // 8. POST /api/voice-assistant/ask -> ${PYTHON_SERVICE_URL}/ask-teacher
  if (pathname === '/voice-assistant/ask') {
    try {
      const pyRes = await fetch(`${pythonBaseUrl}/ask-teacher`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const upstream = await parseUpstreamResponse(pyRes);
      const pyJson = upstream.json || {};
      if (pyRes.status === 401 || pyRes.status === 403) {
        return res.status(pyRes.status).json(pyJson);
      }
      if (pyRes.ok && pyJson.success && pyJson.data) {
        return res.status(200).json({
          success: true,
          transcription: body.question || '',
          transcriptionSource: 'text',
          ...pyJson.data,
        });
      }
      return res.status(422).json(pyJson);
    } catch {
      return res.status(503).json({
        success: false,
        errorCode: 'VOICE_ASSISTANT_UNAVAILABLE',
        error: 'Python coaching service is currently unreachable.',
      });
    }
  }

  return res.status(404).json({
    success: false,
    error: `Unknown API route: ${pathname}`,
  });
}
