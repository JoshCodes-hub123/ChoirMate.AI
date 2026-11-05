import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { SAMPLE_SCORES } from './src/data/sampleScores.ts';

dotenv.config();

process.on('uncaughtException', (err) => {
  console.error('[ChoirMate Server] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[ChoirMate Server] Unhandled rejection:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = fs.existsSync(path.join(__dirname, 'package.json'))
  ? __dirname
  : path.resolve(__dirname, '..');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PYTHON_SERVICE_URL = (
  process.env.PYTHON_SERVICE_URL ||
  process.env.PYTHON_BACKEND_URL ||
  'http://127.0.0.1:5001'
)
  .trim()
  .replace(/\/+$/, '');

const PYTHON_SERVICE_SECRET = (
  process.env.PYTHON_SERVICE_SECRET ||
  process.env.CHOIRMATE_BACKEND_SECRET ||
  ''
).trim();

function isLocalPythonServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '0.0.0.0'
    );
  } catch {
    return url.includes('127.0.0.1') || url.includes('localhost');
  }
}

const IS_LOCAL_PYTHON_BACKEND = isLocalPythonServiceUrl(PYTHON_SERVICE_URL);

function buildPythonHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...(extra || {}),
  };
  if (PYTHON_SERVICE_SECRET) {
    headers['X-ChoirMate-Secret'] = PYTHON_SERVICE_SECRET;
    headers['Authorization'] = `Bearer ${PYTHON_SERVICE_SECRET}`;
  }
  return headers;
}

const FRIENDLY_HOMR_UNAVAILABLE_MESSAGE =
  'Sheet music image and PDF recognition is temporarily unavailable because the HOMR Optical Music Recognition engine is currently offline. You can still upload MusicXML (.musicxml or .xml) files for full note analysis, SATB voice extraction, and practice audio generation.';

// Production CORS Middleware for cross-origin Vercel frontend requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '40mb' }));

// In-Memory Fast LRU Caching for idempotent and repeated requests
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class FastLRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 50, ttlMs = 30 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  set(key: string, data: T): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }
}

const pdfPreviewCache = new FastLRUCache<any>(30, 20 * 60 * 1000);
const sheetAnalysisCache = new FastLRUCache<any>(30, 30 * 60 * 1000);
const audioExportCache = new FastLRUCache<any>(50, 45 * 60 * 1000);

let pythonDaemon: ChildProcess | null = null;
let isBootstrappingPython = false;

interface PythonHealthInfo {
  active: boolean;
  modelLoaded: boolean;
  omrAvailable: boolean;
  omrEngineStatus: 'ready' | 'unavailable_in_environment' | 'backend_offline';
  missingOmrDependencies: string[];
  pdfSupport: boolean;
  musicXmlSupport: boolean;
  voiceStudioAvailable: boolean;
  audioExportAvailable: boolean;
}

async function checkPythonServiceHealth(): Promise<PythonHealthInfo> {
  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/health`, {
      headers: buildPythonHeaders(),
      signal: AbortSignal.timeout(IS_LOCAL_PYTHON_BACKEND ? 1800 : 4000),
    });
    if (pyRes.ok) {
      const healthData: any = await pyRes.json();
      const omrAvailable = Boolean(healthData?.omrAvailable ?? healthData?.modelLoaded);
      return {
        active: true,
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
      };
    }
  } catch {
    // Service not reachable yet
  }
  return {
    active: false,
    modelLoaded: false,
    omrAvailable: false,
    omrEngineStatus: 'backend_offline',
    missingOmrDependencies: [],
    pdfSupport: false,
    musicXmlSupport: false,
    voiceStudioAvailable: false,
    audioExportAvailable: false,
  };
}

async function ensurePythonServiceActive(): Promise<boolean> {
  let health = await checkPythonServiceHealth();
  if (health.active) return true;

  if (!IS_LOCAL_PYTHON_BACKEND) {
    // Remote Python server (e.g. Windows laptop tunnel) cannot be spawned locally
    return false;
  }

  startPythonDaemon();

  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    health = await checkPythonServiceHealth();
    if (health.active) return true;
  }
  return false;
}

function startPythonDaemon(): void {
  if (!IS_LOCAL_PYTHON_BACKEND || pythonDaemon || isBootstrappingPython) return;

  let hasPy3 = false;
  try {
    const check = spawnSync('python3', ['--version'], { stdio: 'ignore' });
    hasPy3 = check.status === 0;
  } catch {
    hasPy3 = false;
  }

  if (!hasPy3) {
    console.warn('[ChoirMate Server] python3 not present in container environment.');
    return;
  }

  const servicePy = path.join(rootDir, 'python', 'service.py');
  if (!fs.existsSync(servicePy)) {
    console.warn('[ChoirMate Server] python/service.py not found.');
    return;
  }

  isBootstrappingPython = true;
  checkPythonServiceHealth()
    .then(({ active }) => {
      isBootstrappingPython = false;
      if (active || pythonDaemon) return;

      let hasUvicorn = false;
      try {
        const uvCheck = spawnSync('python3', ['-c', 'import uvicorn, fastapi'], { stdio: 'ignore' });
        hasUvicorn = uvCheck.status === 0;
      } catch {
        hasUvicorn = false;
      }

      const args = hasUvicorn
        ? ['-m', 'uvicorn', 'python.service:app', '--host', '127.0.0.1', '--port', '5001']
        : [servicePy];

      console.log(
        `[ChoirMate Server] Starting local Python music-processing service on 127.0.0.1:5001 (${hasUvicorn ? 'FastAPI/Uvicorn' : 'stdlib HTTP'})...`
      );
      const proc = spawn('python3', args, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      pythonDaemon = proc;

      proc.on('error', (err: any) => {
        pythonDaemon = null;
        console.warn('[ChoirMate Server] Python daemon startup error:', err.message);
      });

      proc.stdout?.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.log(`[Python Service] ${text}`);
      });

      proc.stderr?.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.error(`[Python Service] ${text}`);
      });

      proc.on('close', (code) => {
        pythonDaemon = null;
        console.log(`[ChoirMate Server] Python service closed (code ${code}).`);
      });
    })
    .catch((err) => {
      isBootstrappingPython = false;
      console.warn('[ChoirMate Server] Python health check skipped:', err?.message);
    });
}

function parseJsonFromStdout(stdoutData: string): any {
  const trimmed = stdoutData.trim();
  if (!trimmed) {
    throw new Error('Empty stdout from Python analysis process');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{') && l.endsWith('}'));
    if (lines.length > 0) {
      return JSON.parse(lines[lines.length - 1]);
    }
    throw new Error('Could not parse JSON from Python output');
  }
}

app.get('/api/health', async (_req, res) => {
  let health = await checkPythonServiceHealth();
  if (!health.active && IS_LOCAL_PYTHON_BACKEND) {
    await ensurePythonServiceActive();
    health = await checkPythonServiceHealth();
  }

  res.json({
    status: 'ok',
    openWeight: true,
    pythonServiceActive: health.active,
    pythonBackendMode: IS_LOCAL_PYTHON_BACKEND ? 'local' : 'remote',
    modelLoaded: health.modelLoaded,
    omrAvailable: health.omrAvailable,
    omrEngineStatus: health.omrEngineStatus,
    missingOmrDependencies: health.missingOmrDependencies,
    pdfSupport: health.pdfSupport,
    musicXmlSupport: health.musicXmlSupport,
    voiceStudioAvailable: health.voiceStudioAvailable,
    audioExportAvailable: health.audioExportAvailable,
    pythonServiceUrl: IS_LOCAL_PYTHON_BACKEND ? PYTHON_SERVICE_URL : '[remote-configured]',
    pythonHost: IS_LOCAL_PYTHON_BACKEND ? '127.0.0.1' : 'remote',
    pythonPort: 5001,
    recognitionEngine: 'HOMR (Full-Score Optical Music Recognition)',
    aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
    modelLicense: 'Apache 2.0',
    sampleScoresCount: SAMPLE_SCORES.length,
  });
});

for (const endpoint of ['voices', 'audio'] as const) {
  app.post(`/api/voice-studio/${endpoint}`, async (req, res) => {
    try {
      await ensurePythonServiceActive();
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/voice-studio/${endpoint}`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(120000),
      });

      const result = await pyResponse.json();
      return res.status(pyResponse.status).json(result);
    } catch (error) {
      console.error('[Voice Studio] Request failed:', error);
      return res.status(503).json({
        success: false,
        errorCode: 'VOICE_STUDIO_UNAVAILABLE',
        error: 'Python Voice Studio service is currently unreachable. Please check backend health.',
      });
    }
  });
}

app.post('/api/preview-pdf', async (req, res) => {
  try {
    const { pdfBase64, fileName } = req.body || {};
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid PDF document payload.',
      });
    }

    const cacheKey = crypto
      .createHash('sha256')
      .update(pdfBase64.slice(0, 10000) + String(pdfBase64.length) + String(fileName || ''))
      .digest('hex');
    const cached = pdfPreviewCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const payload = {
      action: 'preview_pdf',
      pdfBase64,
      fileName: fileName || 'score.pdf',
    };

    await ensurePythonServiceActive();

    const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/preview-pdf`, {
      method: 'POST',
      headers: buildPythonHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });

    const contentType = pyResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const pyJson: any = await pyResponse.json();
      if (pyResponse.status === 401 || pyResponse.status === 403) {
        return res.status(pyResponse.status).json(pyJson);
      }
      if (pyResponse.ok && pyJson.success) {
        pdfPreviewCache.set(cacheKey, pyJson);
        return res.json(pyJson);
      }
      return res.status(422).json({
        success: false,
        errorCode: pyJson?.errorCode || 'PDF_PREVIEW_FAILED',
        error: pyJson?.error || FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
      });
    }

    return res.status(502).json({
      success: false,
      errorCode: 'PDF_PREVIEW_INVALID_RESPONSE',
      error: FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
    });
  } catch (err: any) {
    console.error('Server error in /api/preview-pdf:', err);
    return res.status(503).json({
      success: false,
      errorCode: 'PDF_PREVIEW_UNAVAILABLE',
      error: FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
    });
  }
});

app.post('/api/analyze-sheet', async (req, res) => {
  try {
    const { imageBase64, pages, pdfBase64, pdfFileName, sampleId, musicxml, title, composer, tempo } =
      req.body || {};

    if (sampleId) {
      const sample = SAMPLE_SCORES.find((s) => s.id === sampleId);
      if (sample) {
        return res.json({
          success: true,
          data: sample,
          source: 'demonstration_sample',
        });
      }
    }

    const pageImages: string[] =
      Array.isArray(pages) && pages.length > 0
        ? pages
        : imageBase64
        ? [imageBase64]
        : [];

    if (pageImages.length === 0 && !pdfBase64 && !musicxml) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a sheet music PDF document, page image(s), or a MusicXML file.',
      });
    }

    const cacheKey = crypto
      .createHash('sha256')
      .update(
        (pdfBase64 ? pdfBase64.slice(0, 10000) : '') +
          (pageImages[0] ? pageImages[0].slice(0, 10000) : '') +
          String(pageImages.length) +
          String(pdfFileName || '') +
          String(musicxml ? musicxml.slice(0, 500) : '')
      )
      .digest('hex');

    const cached = sheetAnalysisCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const payload = {
      imageBase64: pageImages.length === 1 && !pdfBase64 ? pageImages[0] : undefined,
      pages: pageImages.length > 1 && !pdfBase64 ? pageImages : undefined,
      pdfBase64: pdfBase64 || undefined,
      pdfFileName: pdfFileName || undefined,
      musicxml,
      title: title || 'Analyzed Score',
      composer: composer || 'Unknown Composer',
      tempo: tempo || 76,
    };

    await ensurePythonServiceActive();

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/analyze`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(240000),
      });

      const contentType = pyResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const pyJson: any = await pyResponse.json();
        if (pyResponse.status === 401 || pyResponse.status === 403) {
          return res.status(pyResponse.status).json(pyJson);
        }
        if (pyResponse.ok && pyJson.success && pyJson.data) {
          if (!pyJson.data.pageImages && pageImages.length > 0) {
            pyJson.data.imageUrl = pageImages[0];
            pyJson.data.pageImages = pageImages;
          }
          sheetAnalysisCache.set(cacheKey, pyJson);
          return res.json(pyJson);
        } else {
          return res.status(422).json({
            success: false,
            errorCode: pyJson?.errorCode || 'OMR_RECOGNITION_FAILED',
            error:
              pyJson?.error ||
              (musicxml
                ? 'Could not parse the uploaded MusicXML file.'
                : FRIENDLY_HOMR_UNAVAILABLE_MESSAGE),
            sectionDiagnostics: pyJson?.sectionDiagnostics || [],
            omrAttempted: Boolean(pyJson?.omrAttempted),
            recognitionEngine: 'HOMR',
          });
        }
      }
    } catch (httpErr) {
      if (!IS_LOCAL_PYTHON_BACKEND) {
        return res.status(503).json({
          success: false,
          errorCode: 'HOMR_ENVIRONMENT_REQUIRED',
          error: FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
        });
      }
      console.warn(
        '[ChoirMate Server] Local Python service (127.0.0.1:5001) unreachable, falling back to local python/analyze.py CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
    }

    const pythonScript = path.resolve(rootDir, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: rootDir });

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    pythonProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    pythonProcess.on('close', () => {
      if (stderrData.trim()) {
        console.error('[Python CLI stderr]:', stderrData.trim());
      }

      if (!stdoutData.trim()) {
        return res.status(503).json({
          success: false,
          errorCode: 'HOMR_ENVIRONMENT_REQUIRED',
          error: FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
        });
      }

      try {
        const parsed = parseJsonFromStdout(stdoutData);
        if (parsed.success && parsed.data) {
          if (!parsed.data.pageImages && pageImages.length > 0) {
            parsed.data.imageUrl = pageImages[0];
            parsed.data.pageImages = pageImages;
          }
          sheetAnalysisCache.set(cacheKey, parsed);
          return res.json(parsed);
        } else {
          return res.status(422).json({
            success: false,
            errorCode: parsed.errorCode || 'OMR_RECOGNITION_FAILED',
            error: parsed.error || FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
          });
        }
      } catch (parseError) {
        console.error('Failed to parse Python pipeline JSON output:', stdoutData, parseError);
        return res.status(500).json({
          success: false,
          error: 'Failed to parse score recognition response.',
        });
      }
    });

    pythonProcess.stdin.write(JSON.stringify(payload));
    pythonProcess.stdin.end();
  } catch (err: any) {
    console.error('Server error in /api/analyze-sheet:', err);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while processing the score upload.',
    });
  }
});

app.post('/api/recalculate-score', async (req, res) => {
  try {
    const { score, partId, updatedNotes, fifths } = req.body || {};
    if (!score || !Array.isArray(updatedNotes)) {
      return res.status(400).json({
        success: false,
        error: 'Missing score object or updatedNotes array.',
      });
    }

    const payload = {
      action: 'recalculate',
      score,
      partId,
      updatedNotes,
      fifths,
    };

    await ensurePythonServiceActive();

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/recalculate`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });

      if (pyResponse.status === 401 || pyResponse.status === 403) {
        const authJson: any = await pyResponse.json().catch(() => ({}));
        return res.status(pyResponse.status).json(authJson);
      }

      if (pyResponse.ok) {
        const pyJson: any = await pyResponse.json();
        if (pyJson.success && pyJson.data) {
          pyJson.data.imageUrl = score.imageUrl;
          pyJson.data.pageImages = score.pageImages;
          return res.json(pyJson);
        }
        return res.status(422).json({
          success: false,
          error: pyJson.error || 'Failed to recalculate score.',
        });
      }
    } catch (httpErr) {
      if (!IS_LOCAL_PYTHON_BACKEND) {
        return res.status(503).json({
          success: false,
          errorCode: 'RECALCULATE_UNAVAILABLE',
          error: 'Python score recalculation service is currently unreachable.',
        });
      }
      console.warn(
        '[ChoirMate Server] Python HTTP service unreachable for recalculate, falling back to CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
      startPythonDaemon();
    }

    const pythonScript = path.resolve(rootDir, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: rootDir });
    let stdoutData = '';
    let stderrData = '';
    pythonProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });
    pythonProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });
    pythonProcess.on('close', () => {
      if (stderrData.trim()) {
        console.error('[Python CLI Recalculate stderr]:', stderrData.trim());
      }
      try {
        const parsed = parseJsonFromStdout(stdoutData);
        if (parsed.success && parsed.data) {
          parsed.data.imageUrl = score.imageUrl;
          parsed.data.pageImages = score.pageImages;
          return res.json(parsed);
        }
        return res.status(422).json({
          success: false,
          error: parsed.error || 'Failed to recalculate score.',
        });
      } catch {
        return res.status(500).json({
          success: false,
          error: 'Failed to parse recalculate response.',
        });
      }
    });
    pythonProcess.stdin.write(JSON.stringify(payload));
    pythonProcess.stdin.end();
  } catch (err: any) {
    console.error('Server error in /api/recalculate-score:', err);
    return res.status(500).json({
      success: false,
      error: 'Recalculate request failed.',
    });
  }
});

app.post('/api/export-audio', async (req, res) => {
  try {
    const { notes, title, partName, scopeLabel, tempo, voice, format, metronome } = req.body || {};
    if (!Array.isArray(notes) || notes.length === 0) {
      return res.status(400).json({
        success: false,
        errorCode: 'EMPTY_NOTES',
        error: 'Cannot export practice audio because no musical notes were provided.',
      });
    }

    const requestedFormat = String(format || 'mp3').toLowerCase() === 'wav' ? 'wav' : 'mp3';
    const payload = {
      action: 'export_audio',
      notes,
      title: title || 'Practice Score',
      partName: partName || 'Vocal Part',
      scopeLabel: scopeLabel || 'Full Song',
      tempo: Number(tempo || 88),
      voice: voice || 'choir',
      format: requestedFormat,
      metronome: Boolean(metronome),
    };

    const sendExportResult = (resultJson: any) => {
      if (req.query.binary === '1' && resultJson.audioBase64) {
        const audioBuffer = Buffer.from(resultJson.audioBase64, 'base64');
        res.setHeader('Content-Type', resultJson.mimeType || (requestedFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav'));
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${resultJson.fileName || `practice.${requestedFormat}`}"`
        );
        res.setHeader('Content-Length', String(audioBuffer.length));
        return res.send(audioBuffer);
      }
      return res.json(resultJson);
    };

    const cacheKey = crypto
      .createHash('sha256')
      .update(
        `${title}_${partName}_${scopeLabel}_${tempo}_${voice}_${requestedFormat}_${metronome}_${notes.length}_${notes[0]?.pitch || ''}_${notes[notes.length - 1]?.pitch || ''}`
      )
      .digest('hex');

    const cached = audioExportCache.get(cacheKey);
    if (cached) {
      return sendExportResult(cached);
    }

    await ensurePythonServiceActive();

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/export-audio`, {
        method: 'POST',
        headers: buildPythonHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });

      if (pyResponse.status === 401 || pyResponse.status === 403) {
        const authJson: any = await pyResponse.json().catch(() => ({}));
        return res.status(pyResponse.status).json(authJson);
      }

      if (pyResponse.ok) {
        const pyJson: any = await pyResponse.json();
        if (pyJson.success && pyJson.audioBase64) {
          audioExportCache.set(cacheKey, pyJson);
          return sendExportResult(pyJson);
        }
        return res.status(422).json({
          success: false,
          errorCode: pyJson.errorCode || 'AUDIO_EXPORT_FAILED',
          error: pyJson.error || 'Could not generate practice audio.',
        });
      }
    } catch (httpErr) {
      if (!IS_LOCAL_PYTHON_BACKEND) {
        return res.status(503).json({
          success: false,
          errorCode: 'AUDIO_EXPORT_UNAVAILABLE',
          error: 'Python audio export service is currently unreachable.',
        });
      }
      console.warn(
        '[ChoirMate Server] Python service unreachable for /export-audio, falling back to CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
      startPythonDaemon();
    }

    const pythonScript = path.resolve(rootDir, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: rootDir });
    let stdoutData = '';
    let stderrData = '';
    pythonProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });
    pythonProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });
    pythonProcess.on('close', () => {
      if (stderrData.trim()) {
        console.error('[Python CLI export-audio stderr]:', stderrData.trim());
      }
      try {
        const parsed = parseJsonFromStdout(stdoutData);
        if (parsed.success && parsed.audioBase64) {
          return sendExportResult(parsed);
        }
        return res.status(422).json({
          success: false,
          errorCode: parsed.errorCode || 'AUDIO_EXPORT_FAILED',
          error: parsed.error || 'Could not generate practice audio.',
        });
      } catch {
        return res.status(500).json({
          success: false,
          error: 'Failed to synthesize downloadable practice audio.',
        });
      }
    });
    pythonProcess.stdin.write(JSON.stringify(payload));
    pythonProcess.stdin.end();
  } catch (err: any) {
    console.error('Server error in /api/export-audio:', err);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while generating practice audio.',
    });
  }
});

async function transcribeWithAssemblyAI(audioBase64: string, apiKey: string): Promise<string> {
  const cleanedBase64 = audioBase64.includes(',') ? audioBase64.split(',', 2)[1] : audioBase64;
  const audioBuffer = Buffer.from(cleanedBase64.trim(), 'base64');
  if (audioBuffer.length < 100) {
    throw new Error('Recorded audio clip is empty or too short to transcribe.');
  }

  // 1. Upload raw audio bytes to AssemblyAI /v2/upload
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(25000),
  });

  if (!uploadRes.ok) {
    throw new Error(`AssemblyAI audio upload returned HTTP ${uploadRes.status}. Please check your ASSEMBLYAI_API_KEY.`);
  }
  const uploadJson: any = await uploadRes.json();
  const uploadUrl = uploadJson?.upload_url;
  if (!uploadUrl) {
    throw new Error('AssemblyAI did not return a valid upload_url.');
  }

  // 2. Create transcript job at AssemblyAI /v2/transcript
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: uploadUrl,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!transcriptRes.ok) {
    throw new Error(`AssemblyAI transcript creation returned HTTP ${transcriptRes.status}.`);
  }
  const transcriptJob: any = await transcriptRes.json();
  const transcriptId = transcriptJob?.id;
  if (!transcriptId) {
    throw new Error('AssemblyAI did not return a transcript ID.');
  }

  // 3. Poll until completed or error (max ~35s)
  for (let attempt = 0; attempt < 28; attempt++) {
    await new Promise((r) => setTimeout(r, 1250));
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: {
        Authorization: apiKey,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!pollRes.ok) {
      throw new Error(`AssemblyAI status check returned HTTP ${pollRes.status}.`);
    }
    const pollData: any = await pollRes.json();
    if (pollData.status === 'completed') {
      const text = (pollData.text || '').trim();
      if (!text) {
        throw new Error('No spoken words were detected in the recording. Please speak clearly and try again.');
      }
      return text;
    }
    if (pollData.status === 'error') {
      throw new Error(pollData.error || 'AssemblyAI could not transcribe the audio recording.');
    }
  }

  throw new Error('AssemblyAI transcription timed out. Please try a shorter voice question.');
}

async function askSmolLM2Teacher(payload: Record<string, any>): Promise<any> {
  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/ask-teacher`, {
      method: 'POST',
      headers: buildPythonHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (pyRes.ok) {
      const pyJson: any = await pyRes.json();
      if (pyJson.success && pyJson.data) {
        return pyJson.data;
      }
    }
  } catch {
    startPythonDaemon();
  }

  return new Promise((resolve, reject) => {
    const pythonScript = path.resolve(rootDir, 'python', 'analyze.py');
    const proc = spawn('python3', [pythonScript, '-'], { cwd: rootDir });
    let out = '';
    proc.on('error', (err: any) => {
      console.warn('[ChoirMate Server] python3 not available for askSmolLM2Teacher, returning fallback coaching:', err.message);
      resolve({
        answer: `As your choir vocal coach, I notice you asked about "${payload.question || 'this section'}". Remember to keep your soft palate lifted, maintain steady breath support from your diaphragm, and listen closely to your pitch center!`,
        tips: ['Lift soft palate', 'Steady breath support', 'Match pitch accurately'],
        solfaFocus: 'Do - Mi - Sol resonance',
      });
    });
    proc.stdout.on('data', (c) => (out += c.toString()));
    proc.on('close', () => {
      try {
        const parsed = parseJsonFromStdout(out);
        if (parsed.success && parsed.data) {
          resolve(parsed.data);
        } else {
          reject(new Error(parsed.error || 'Could not answer question'));
        }
      } catch (e) {
        reject(e);
      }
    });
    proc.stdin.write(JSON.stringify({ ...payload, action: 'ask_teacher' }));
    proc.stdin.end();
  });
}

app.get('/api/voice-assistant/status', (_req, res) => {
  const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
  res.json({
    success: true,
    assemblyAiConfigured: Boolean(apiKey),
    provider: 'AssemblyAI Speech-to-Text API',
    teacherModel: 'SmolLM2-360M-Instruct-GGUF (Local Open-Weight)',
    capabilityNotice:
      'AssemblyAI is used strictly for server-side speech-to-text transcription of your spoken music questions and practice reflections after explicit user consent. Musical pitch & solfa analysis are performed locally.',
  });
});

app.post('/api/voice-assistant/ask', async (req, res) => {
  try {
    const {
      audioBase64,
      question,
      userConsentGiven,
      title,
      partName,
      keySignature,
      timeSignature,
      notes,
    } = req.body || {};

    let finalQuestion = typeof question === 'string' ? question.trim() : '';
    let transcriptionSource: 'assemblyai' | 'text' = 'text';

    if (audioBase64 && typeof audioBase64 === 'string') {
      if (!userConsentGiven) {
        return res.status(400).json({
          success: false,
          errorCode: 'CONSENT_REQUIRED',
          error:
            'Explicit user consent is required before sending recorded voice audio for speech-to-text transcription.',
        });
      }

      const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
      if (!apiKey) {
        return res.status(200).json({
          success: false,
          errorCode: 'ASSEMBLYAI_NOT_CONFIGURED',
          error:
            'Voice transcription requires ASSEMBLYAI_API_KEY to be configured on the server. You can type your question directly below—local SmolLM2 music coaching works without any external API key.',
        });
      }

      try {
        finalQuestion = await transcribeWithAssemblyAI(audioBase64, apiKey);
        transcriptionSource = 'assemblyai';
      } catch (transErr: any) {
        return res.status(422).json({
          success: false,
          errorCode: 'TRANSCRIPTION_FAILED',
          error:
            transErr instanceof Error
              ? transErr.message
              : 'Could not transcribe the spoken audio clip.',
        });
      }
    }

    if (!finalQuestion) {
      return res.status(400).json({
        success: false,
        errorCode: 'EMPTY_QUESTION',
        error: 'Please record a spoken question or type a question about this score.',
      });
    }

    const teacherData = await askSmolLM2Teacher({
      question: finalQuestion,
      title: title || 'Active Score',
      partName: partName || 'Vocal Part',
      keySignature: keySignature || {},
      timeSignature: timeSignature || {},
      notes: Array.isArray(notes) ? notes : [],
    });

    return res.json({
      success: true,
      transcription: finalQuestion,
      transcriptionSource,
      ...teacherData,
    });
  } catch (err: any) {
    console.error('Server error in /api/voice-assistant/ask:', err instanceof Error ? err.message : err);
    return res.status(500).json({
      success: false,
      errorCode: 'VOICE_ASSISTANT_ERROR',
      error: 'Could not complete your music coaching request. Please try again.',
    });
  }
});

async function startServer() {
  startPythonDaemon();

  const distHtmlInRoot = path.join(rootDir, 'dist', 'index.html');
  const distHtmlInCurrent = path.join(__dirname, 'index.html');
  const distIndexHtml = fs.existsSync(distHtmlInRoot)
    ? distHtmlInRoot
    : fs.existsSync(distHtmlInCurrent)
    ? distHtmlInCurrent
    : null;
  const distDir = distIndexHtml ? path.dirname(distIndexHtml) : null;

  if (distIndexHtml && distDir) {
    console.log('[ChoirMate Server] Serving static build from:', distDir);
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(distIndexHtml);
    });
  } else {
    console.log('[ChoirMate Server] Mounting Vite development middleware...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: rootDir,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChoirMate AI open-weight server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[ChoirMate Server] Received ${signal}. Terminating services cleanly...`);
    if (pythonDaemon) {
      try {
        pythonDaemon.kill('SIGTERM');
      } catch {
        // Process may already be closed
      }
    }
    server.close(() => {
      console.log('[ChoirMate Server] HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 5s if connections linger
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();


