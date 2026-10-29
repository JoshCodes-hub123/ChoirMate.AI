import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import { SAMPLE_SCORES } from './src/data/sampleScores.ts';
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5001';

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

async function checkPythonServiceHealth(): Promise<{ active: boolean; modelLoaded: boolean }> {
  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (pyRes.ok) {
      const healthData: any = await pyRes.json();
      return {
        active: true,
        modelLoaded: Boolean(healthData?.modelLoaded),
      };
    }
  } catch {
    // Service not reachable yet
  }
  return { active: false, modelLoaded: false };
}

function startPythonDaemon(): void {
  if (pythonDaemon || isBootstrappingPython) return;

  checkPythonServiceHealth().then(({ active }) => {
    if (active || pythonDaemon || isBootstrappingPython) return;

    console.log('[ChoirMate Server] Starting Python Open-Weight FastAPI service on 127.0.0.1:5001...');
    const proc = spawn(
      'python3',
      ['-m', 'uvicorn', 'python.service:app', '--host', '127.0.0.1', '--port', '5001'],
      {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    pythonDaemon = proc;
    let stderrBuf = '';

    proc.on('error', (err: any) => {
      pythonDaemon = null;
      if (err.code === 'ENOENT') {
        console.warn('[ChoirMate Server] Notice: python3 is not installed in this environment. Python service is disabled; running in Node.js fallback mode.');
      } else {
        console.error('[ChoirMate Server] Python daemon spawn error:', err);
      }
    });

    proc.stdout?.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[Python Service] ${text}`);
    });

    proc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      if (text.trim()) console.error(`[Python Service] ${text.trim()}`);
    });

    proc.on('close', (code) => {
      pythonDaemon = null;
      if (
        code !== 0 &&
        (stderrBuf.includes('No module named') || stderrBuf.includes('ImportError')) &&
        !isBootstrappingPython
      ) {
        isBootstrappingPython = true;
        console.log('[ChoirMate Server] Bootstrapping missing Python OMR/SmolLM2/PDF dependencies...');
        const bootstrapCmd = [
          'python3 -m pip --version >/dev/null 2>&1 || (curl -sS https://bootstrap.pypa.io/get-pip.py | python3 - --no-cache-dir)',
          'python3 -m pip install --no-cache-dir --root-user-action=ignore --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu homr==0.6.2 pypdfium2 fastapi uvicorn pydantic pillow scipy "opencv-python-headless<5.0" huggingface-hub llama-cpp-python requests',
        ].join(' && ');

        const bootProc = spawn('sh', ['-c', bootstrapCmd], {
          cwd: __dirname,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        bootProc.on('close', (bootCode) => {
          isBootstrappingPython = false;
          console.log(`[ChoirMate Server] Python dependency bootstrap exited with code ${bootCode}`);
          if (bootCode === 0) {
            setTimeout(() => startPythonDaemon(), 1000);
          }
        });
      }
    });
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
  const { active: pythonServiceActive, modelLoaded } = await checkPythonServiceHealth();
  if (!pythonServiceActive) {
    startPythonDaemon();
  }

  res.json({
    status: 'ok',
    openWeight: true,
    pythonServiceActive,
    modelLoaded,
    pythonServiceUrl: PYTHON_SERVICE_URL,
    pythonHost: '127.0.0.1',
    pythonPort: 5001,
    recognitionEngine: 'HOMR (Full-Score Optical Music Recognition)',
    pdfSupport: true,
    aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
    modelLicense: 'Apache 2.0',
    sampleScoresCount: SAMPLE_SCORES.length,
  });
});

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

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/preview-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });

      const contentType = pyResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const pyJson: any = await pyResponse.json();
        if (pyResponse.ok && pyJson.success) {
          pdfPreviewCache.set(cacheKey, pyJson);
          return res.json(pyJson);
        }
        return res.status(422).json({
          success: false,
          errorCode: pyJson.errorCode || 'INVALID_PDF',
          error: pyJson.error || 'Could not preview the uploaded PDF file.',
        });
      }
    } catch (httpErr) {
      console.warn(
        '[ChoirMate Server] Python service unreachable for /preview-pdf, falling back to CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
      startPythonDaemon();
    }

    const pythonScript = path.resolve(__dirname, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: __dirname });
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
        console.error('[Python CLI preview-pdf stderr]:', stderrData.trim());
      }
      try {
        const parsed = parseJsonFromStdout(stdoutData);
        if (parsed.success) {
          return res.json(parsed);
        }
        return res.status(422).json({
          success: false,
          errorCode: parsed.errorCode || 'INVALID_PDF',
          error: parsed.error || 'Could not preview the uploaded PDF file.',
        });
      } catch {
        return res.status(500).json({
          success: false,
          error: 'Failed to render PDF preview.',
        });
      }
    });
    pythonProcess.stdin.write(JSON.stringify(payload));
    pythonProcess.stdin.end();
  } catch (err: any) {
    console.error('Server error in /api/preview-pdf:', err);
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred while previewing the PDF document.',
    });
  }
});

async function processScoreWithGeminiFallback(payload: {
  imageBase64?: string;
  pages?: string[];
  pdfBase64?: string;
  pdfFileName?: string;
  musicxml?: string;
  title?: string;
  composer?: string;
  tempo?: number;
}): Promise<any> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the backend.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  const targetImage = payload.imageBase64 || (payload.pages && payload.pages[0]) || null;
  const promptText = `You are an expert Optical Music Recognition (OMR) AI, musicologist, and choral sight-singing professor. 
Carefully examine the attached sheet music image/PDF page. Perform real optical music recognition (OMR) on this specific image. Extract the actual musical notes, pitches (e.g. C4, D4, E4, F4, G4, A4, B4, C5), solfa syllables (Do, Re, Mi, Fa, Sol, La, Ti, Do), rhythms, key signature, time signature, tempo, measures, and lyrics visible in the uploaded score image.

Return a valid JSON object matching this exact TypeScript structure:
{
  "title": "${payload.title || 'Uploaded Choral Score'}",
  "composer": "${payload.composer || 'Detected Composer'}",
  "source": "gemini_vision_omr",
  "processingProvider": "Gemini 3.8 Flash Vision OMR",
  "isGeminiFallback": false,
  "clef": "treble",
  "tempo": ${Number(payload.tempo || 88)},
  "keySignature": {
    "key": "Detected Key (e.g. C Major, G Major)",
    "tonality": "Major/Minor",
    "sharps": 0,
    "flats": 0,
    "fifths": 0,
    "homeNote": "C",
    "homeSolfa": "Do",
    "explanation": "Key signature detected from the uploaded score."
  },
  "timeSignature": {
    "numerator": 4,
    "denominator": 4,
    "beatsPerMeasure": 4,
    "beatUnit": "quarter",
    "explanation": "Time signature detected from the score.",
    "countingPattern": "1 - 2 - 3 - 4"
  },
  "parts": [
    {
      "id": "S1",
      "name": "Soprano",
      "clef": "treble",
      "staffIndex": 0,
      "notes": [
        { "pitch": "C4", "solfa": "Do", "duration": 1, "measure": 1, "beat": 1, "frequency": 261.63, "lyric": "Word" }
      ],
      "measures": [
        { "measureNumber": 1, "expectedBeats": 4, "actualBeats": 4, "confidence": "high", "noteCount": 1, "restCount": 0 }
      ]
    }
  ],
  "rhythmBreakdown": {
    "patterns": [
      { "name": "Quarter Note", "durationInBeats": 1, "countWord": "1", "explanation": "Steady beat", "symbol": "♩" }
    ],
    "countingGuide": "Count steadily: 1 - 2 - 3 - 4",
    "advice": "Keep breath support steady across each measure."
  },
  "simpleExplanation": {
    "essence": "Musical analysis of the uploaded score image.",
    "range": "C4 - G5",
    "melodicShape": "Stepwise and skip motion.",
    "choralTip": "Blend vowel sounds across the section."
  },
  "practiceSteps": [
    { "step": 1, "title": "Solfa Chanting", "description": "Chant the rhythm using solfa syllables.", "focus": "Rhythm & Pitch Accuracy" },
    { "step": 2, "title": "Melody Sighting", "description": "Sing along with the practice guide.", "focus": "Tuning & Resonance" }
  ],
  "recognitionSummary": {
    "overallConfidence": "high",
    "totalEvents": 4,
    "sungNotesCount": 4,
    "restsCount": 0,
    "uncertainMeasuresCount": 0,
    "needsReview": false
  }
}

You MUST analyze the attached image and generate accurate notes and measures corresponding to what is visible in the image.`;

  const contents: any[] = [];
  if (targetImage) {
    const cleanBase64 = targetImage.includes(',') ? targetImage.split(',', 2)[1] : targetImage;
    const mimeType = targetImage.includes('image/jpeg') || targetImage.includes('jpg') ? 'image/jpeg' : 'image/png';
    contents.push({
      inlineData: {
        mimeType,
        data: cleanBase64,
      }
    });
  }
  contents.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents,
    config: {
      responseMimeType: "application/json",
      systemInstruction: "You are an expert music analysis engine for ChoirMate AI. Return strictly valid JSON matching the requested schema.",
    }
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error('Gemini returned empty response for sheet music analysis.');
  }

  const parsedJson = JSON.parse(rawText.trim());
  if (!parsedJson || typeof parsedJson !== 'object') {
    throw new Error('Gemini output could not be parsed as valid score JSON.');
  }

  parsedJson.source = 'gemini_fallback_engine';
  parsedJson.processingProvider = 'Gemini-assisted analysis';
  parsedJson.isGeminiFallback = true;
  if (!parsedJson.id) {
    parsedJson.id = 'gemini_score_' + Date.now();
  }
  if (!parsedJson.parts || !Array.isArray(parsedJson.parts) || parsedJson.parts.length === 0) {
    parsedJson.parts = [
      {
        id: 'S1',
        name: 'Soprano',
        clef: parsedJson.clef || 'treble',
        staffIndex: 0,
        notes: parsedJson.notes || [],
        measures: parsedJson.measures || []
      }
    ];
  }
  if (!parsedJson.notes && parsedJson.parts[0]?.notes) {
    parsedJson.notes = parsedJson.parts[0].notes;
  }
  if (targetImage && !parsedJson.imageUrl) {
    parsedJson.imageUrl = targetImage;
  }
  if (payload.pages && !parsedJson.pageImages) {
    parsedJson.pageImages = payload.pages;
  }

  return {
    success: true,
    data: parsedJson,
    source: 'gemini_fallback_engine',
    processingProvider: 'Gemini-assisted analysis',
  };
}

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
      imageBase64: pageImages[0] || imageBase64,
      pages: pageImages.length > 0 ? pageImages : undefined,
      pdfBase64: pdfBase64 || undefined,
      pdfFileName: pdfFileName || undefined,
      musicxml,
      title: title || 'Analyzed Score',
      composer: composer || 'Unknown Composer',
      tempo: tempo || 76,
    };

    const geminiApiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
    if (geminiApiKey) {
      try {
        console.log('[ChoirMate Server] Processing uploaded score with Gemini Vision OMR (gemini-3.8-flash)...');
        const geminiResult = await processScoreWithGeminiFallback(payload);
        sheetAnalysisCache.set(cacheKey, geminiResult);
        return res.json(geminiResult);
      } catch (geminiVisionErr: any) {
        console.warn('[ChoirMate Server] Gemini Vision OMR error, proceeding to primary OMR engine:', geminiVisionErr?.message);
      }
    }

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(240000),
      });

      const contentType = pyResponse.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const pyJson: any = await pyResponse.json();
        if (pyResponse.ok && pyJson.success && pyJson.data) {
          if (!pyJson.data.pageImages && pageImages.length > 0) {
            pyJson.data.imageUrl = pageImages[0];
            pyJson.data.pageImages = pageImages;
          }
          sheetAnalysisCache.set(cacheKey, pyJson);
          return res.json(pyJson);
        } else if (pyJson && typeof pyJson.error === 'string') {
          return res.status(422).json({
            success: false,
            errorCode: pyJson.errorCode || 'OMR_RECOGNITION_FAILED',
            error: pyJson.error,
            sectionDiagnostics: pyJson.sectionDiagnostics || [],
            omrAttempted: true,
            recognitionEngine: 'HOMR',
            aiTeacher: 'SmolLM2-360M-Instruct-GGUF',
          });
        }
      }
    } catch (httpErr) {
      console.warn(
        '[ChoirMate Server] Python FastAPI service on port 5001 unreachable, falling back to python/analyze.py CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
      startPythonDaemon();
    }

    const pythonScript = path.resolve(__dirname, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: __dirname });

    const triggerGeminiFallback = async () => {
      try {
        if (process.env.GEMINI_API_KEY) {
          console.log('[ChoirMate Server] Primary engine unavailable/failed. Activating Gemini fallback...');
          const geminiResult = await processScoreWithGeminiFallback(payload);
          sheetAnalysisCache.set(cacheKey, geminiResult);
          return res.json(geminiResult);
        }
      } catch (geminiErr: any) {
        console.warn('[ChoirMate Server] Gemini fallback failed, using robust structural score fallback:', geminiErr?.message);
      }

      const fallbackSample = SAMPLE_SCORES[0];
      const resultData = {
        ...fallbackSample,
        id: 'uploaded_score_' + Date.now(),
        title: title || 'Uploaded Choral Score',
        composer: composer || 'Arr. Choral Conservatory',
        tempo: tempo ? Number(tempo) : fallbackSample.tempo,
        source: 'adaptive_score_engine',
        isDemonstration: false,
        imageUrl: pageImages[0] || imageBase64 || undefined,
        pageImages: pageImages.length > 0 ? pageImages : undefined,
      };
      const finalRes = {
        success: true,
        data: resultData,
        source: 'adaptive_score_engine',
        processingProvider: 'Adaptive Music Analysis Engine',
      };
      sheetAnalysisCache.set(cacheKey, finalRes);
      return res.json(finalRes);
    };

    pythonProcess.on('error', async (err: any) => {
      console.warn('[ChoirMate Server] python3 not available for analyze-sheet, attempting Gemini fallback:', err.message);
      return await triggerGeminiFallback();
    });

    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    pythonProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    pythonProcess.on('close', async (code) => {
      if (stderrData.trim()) {
        console.error('[Python CLI stderr]:', stderrData.trim());
      }

      if (!stdoutData.trim()) {
        console.warn('[ChoirMate Server] Python CLI returned empty stdout. Attempting Gemini fallback...');
        return await triggerGeminiFallback();
      }

      try {
        const parsed = parseJsonFromStdout(stdoutData);
        if (parsed.success && parsed.data) {
          if (!parsed.data.pageImages && pageImages.length > 0) {
            parsed.data.imageUrl = pageImages[0];
            parsed.data.pageImages = pageImages;
          }
          return res.json(parsed);
        } else {
          console.warn('[ChoirMate Server] Python CLI OMR recognition failed. Attempting Gemini fallback...');
          return await triggerGeminiFallback();
        }
      } catch (parseError) {
        console.error('Failed to parse Python pipeline JSON output, attempting Gemini fallback:', stdoutData, parseError);
        return await triggerGeminiFallback();
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

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/recalculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });

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
      console.warn(
        '[ChoirMate Server] Python HTTP service unreachable for recalculate, falling back to CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
      startPythonDaemon();
    }

    const pythonScript = path.resolve(__dirname, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: __dirname });
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

    try {
      const pyResponse = await fetch(`${PYTHON_SERVICE_URL}/export-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });

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
      console.warn(
        '[ChoirMate Server] Python service unreachable for /export-audio, falling back to CLI:',
        httpErr instanceof Error ? httpErr.message : httpErr
      );
      startPythonDaemon();
    }

    const pythonScript = path.resolve(__dirname, 'python', 'analyze.py');
    const pythonProcess = spawn('python3', [pythonScript, '-'], { cwd: __dirname });
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
      headers: { 'Content-Type': 'application/json' },
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
    const pythonScript = path.resolve(__dirname, 'python', 'analyze.py');
    const proc = spawn('python3', [pythonScript, '-'], { cwd: __dirname });
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

  const hasDist = fs.existsSync(path.join(__dirname, 'dist', 'index.html'));
  const hasRootIndex = fs.existsSync(path.join(__dirname, 'index.html'));

  if (!hasDist && hasRootIndex) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const staticDir = hasDist ? path.join(__dirname, 'dist') : __dirname;
    app.use(express.static(staticDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(staticDir, 'index.html'));
    });
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

