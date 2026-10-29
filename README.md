# ChoirMate AI — Open-Weight Sheet Music OMR, Solfa Tutor & Practice Audio Studio

**Submitted to OPEN//BUILD 2026 | Theme: “AI belongs to everyone.”**

Repository: [https://github.com/JoshCodes-hub123/choirmate-ai](https://github.com/JoshCodes-hub123/choirmate-ai)  
Target Branch: `main`  
Application License: GNU General Public License v3.0 (GPL-3.0)  
Live Application Preview: [https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app](https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app)

---

## 1. Project Overview & Purpose

A printed choir score can feel like an impenetrable wall of symbols for beginner singers and community choir members. Staff lines, clefs, accidentals, key signatures, and dotted rhythms often present a barrier to independent rehearsal between weekly choir practices.

**ChoirMate AI** bridges this gap. It transforms printed choral sheet music (**multi-page PDF scores**, **PNG/JPG scans**, or **MusicXML**) into:
1. **Movable-Do Solfa syllables** mapped to the score's key signature across vocal parts (Soprano, Alto, Tenor, Bass).
2. **Interactive Note Review & Correction**: Edit any recognized note, accidental, or rhythm with instant recalculation.
3. **Downloadable Practice Audio (`MP3` & `WAV`)**: Export synthesized polyphonic rehearsal audio for the entire score or a selected practice section, matching all user corrections.
4. **Grounded AI Vocal Coaching**: An open-weight **SmolLM2-360M-Instruct-GGUF** model explains the score's essence, vocal range, rhythm counting patterns, and answers spoken (via AssemblyAI) or typed questions using verified notation facts.

---

## 2. Screenshot / Interface Showcase

```
+-----------------------------------------------------------------------------------------+
| [Music] ChoirMate AI       [Studio Home]  [Upload Score]  [Learn & Audio] [Practice Coach]|
+-----------------------------------------------------------------------------------------+
|  Key: F Major | Meter: 3/4 | Part: Treble Voices (Soprano / Alto) | Confidence: High    |
|  [ Play Reference ]  [ Pause ]  [ Restart ]  [ Loop ON ]  [ Voice: Choir Synth ]        |
|  Download Practice Audio:  [ Download MP3 ]  [ Download WAV ]                           |
|  (amazing-grace_soprano_full-song_88bpm.mp3)                                            |
+-----------------------------------------------------------------------------------------+
| [ ORIGINAL SCORE REFERENCE (PAGE 1) ]  |  [ RECONSTRUCTED INTERACTIVE NOTATION STAVE ]  |
|                                         |                                                 |
|  System 1: [========= Staves =========] |   𝄞  ♩ (Do)  ♩ (Re)  ♩ (Mi)  𝄽 (Rest)          |
|  System 2: [========= Staves =========] |   m.1        m.2        m.3        m.4          |
+-----------------------------------------------------------------------------------------+
| [ ASK YOUR CHOIR COACH (Voice Transcription via AssemblyAI + Local SmolLM2 Teacher) ]   |
|  [X] Voice Consent: Enabled | "What is my vocal range and opening Solfa sequence?"      |
|  Coach: "Your vocal range spans G#3 up to A6. Your melody opens on Sol (G4)..."         |
+-----------------------------------------------------------------------------------------+
```
*(Genuine screenshot placeholder: upload real screenshot to `docs/screenshots/choirmate-hero.png`)*

---

## 3. Technology Stack & Architecture

ChoirMate AI strictly separates optical music recognition, music theory calculations, audio synthesis, and language coaching:

```
[Uploaded Sheet Music: PDF / PNG / JPG / MusicXML]
                     │
                     ▼
       ┌───────────────────────────┐
       │     PDF / Image Intake    │ (pypdfium2, PIL, OpenCV deskew)
       └─────────────┬─────────────┘
                     │
                     ▼
       ┌───────────────────────────┐
       │   Optical Music Recog     │ (HOMR 0.6.2: deep neural vision for staves,
       │          (OMR)            │  clefs, noteheads, measures -> MusicXML)
       └─────────────┬─────────────┘
                     │
                     ▼
       ┌───────────────────────────┐
       │ Deterministic MusicTheory │ (music21: Movable-Do solfa, tonality,
       │   Validation & Parser     │  beat-sum validation, frequency mapping)
       └───────┬───────────┬───────┘
               │           │
       ┌───────▼──────┐  ┌─▼────────────────────────────────────────┐
       │ Audio Export │  │ SmolLM2-360M-Instruct-GGUF               │
       │  Synthesizer │  │ (Local CPU inference via llama-cpp-python│
       │ (WAV + MP3)  │  │  explains facts & answers questions)     │
       └───────┬──────┘  └─▲────────────────────────────────────────┘
               │           │ (transcribed text)
               │         ┌─┴────────────────────────┐
               │         │ AssemblyAI STT API       │
               │         │ (Server-side voice Q&A;  │
               │         │  explicit user consent)  │
               │         └──────────────────────────┘
               ▼
   [ChoirMate AI React/Tailwind Conservatory Studio]
```

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Vite 8, Web Audio API.
- **Node.js Backend**: Express 4 (`server.ts`) serving proxy routes, process orchestration, and static bundles.
- **Python Service**: FastAPI on `127.0.0.1:5001` running HOMR OMR, `pypdfium2`, `music21`, `scipy`/`numpy` audio synthesis, and `llama-cpp-python`.
- **Audio Engine**: Polyphonic reference synthesis (`choir`, `piano`, `strings`) exported via `/usr/bin/ffmpeg` (`libmp3lame`) at 44.1 kHz.

---

## 4. The Meaningful Role of Open-Weight AI

### SmolLM2-360M-Instruct-GGUF
- **Identifier**: `bartowski/SmolLM2-360M-Instruct-GGUF` (`SmolLM2-360M-Instruct-Q4_K_M.gguf`)
- **Author**: Hugging Face (Loubna Ben Allal et al.)
- **License**: Apache-2.0
- **What it does**: SmolLM2 acts as the choir director. It generates beginner-friendly musical summaries, rhythm counting guides, vocal warmup steps, and answers student questions.
- **What it does NOT do**: SmolLM2 is a text-based language model. It does not inspect images or perform optical character recognition. It receives strictly validated, structured musical facts (key, tonic, time signature, note count, solfa syllables, range) so it never hallucinates notes.
- **Runtime**: Runs locally on CPU via `llama-cpp-python` with 4 threads, requiring < 250 MB of RAM.

### HOMR (oemer)
- **Identifier**: `homr` 0.6.2 (by BreezeWhite)
- **License**: GNU General Public License v3.0 (GPL-3.0)
- **Role**: Handles the computer vision and optical music recognition (OMR) stage, detecting staff lines, clefs, noteheads, and accidentals to produce structured MusicXML.

---

## 5. Responsible AssemblyAI Integration

- **Role**: High-accuracy speech-to-text transcription for spoken rehearsal questions and vocal practice reflections.
- **Backend-Only Security**: Calls to `https://api.assemblyai.com/v2/upload` and `/v2/transcript` are executed strictly inside `server.ts`. The `ASSEMBLYAI_API_KEY` is never exposed to the browser, logs, or bundle.
- **Explicit User Consent**: Recording audio requires the user to opt-in via a consent checkbox explaining that voice audio will be sent for transcription.
- **100% Offline / No-Key Fallback**: If `ASSEMBLYAI_API_KEY` is absent, the system gracefully notifies the user and provides instant typed Q&A with local SmolLM2. All OMR, playback, solfa, and audio downloads remain fully operational without any API key.

---

## 6. Installation & Setup

### Prerequisites
- Node.js 18+ (tested on Node.js 20 & 22)
- Python 3.10, 3.11, or 3.12
- FFmpeg (for MP3 audio encoding):
  ```bash
  sudo apt-get install -y ffmpeg
  ```

### Step 1: Clone Repository
```bash
git clone https://github.com/JoshCodes-hub123/choirmate-ai.git
cd choirmate-ai
```

### Step 2: Install Node Dependencies
```bash
npm install
```

### Step 3: Install Python Dependencies
```bash
pip install -r python/requirements.txt
```
*Note: For precompiled CPU wheels of `llama-cpp-python`, install with:*
```bash
pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu llama-cpp-python
```

### Step 4: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` (optional):
```bash
# Model downloads automatically to /tmp/choirmate-models if unset
SMOLLM2_MODEL_PATH="/tmp/choirmate-models/SmolLM2-360M-Instruct-Q4_K_M.gguf"
PYTHON_SERVICE_URL="http://127.0.0.1:5001"
ASSEMBLYAI_API_KEY="" # Optional: for spoken question voice transcription
```

### Step 5: Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser. The Node.js server automatically starts the Python microservice on port 5001.

---

## 7. Testing & Verification

Run the end-to-end automated test suite:
```bash
python3 python/test_pdf_pipeline.py
```
Run frontend typechecking and production build:
```bash
npm run lint
npm run build
```

### Automated Test Results (Audited 2026-10-29)
| Test Case | Method / Endpoint | Real Result |
|---|---|---|
| Corrupt / Invalid PDF Handling | `POST /api/preview-pdf` | **PASS**: Returns 422 with actionable error; no traceback leak |
| Single-Page PDF Score OMR | `POST /api/analyze-sheet` | **PASS**: Decoded 129 notes, 4 systems, 2 parts, Solfa extracted |
| Multi-Page (2-Page) PDF Score | `POST /api/analyze-sheet` | **PASS**: Preserved page order `[1, 1, 2, 2]`, note pages `[1, 2]` |
| Partial Failure Handling | `POST /api/analyze-sheet` | **PASS**: Page 1 recognized; Page 2 reported in `failedPages: [2]` |
| PNG Image Upload Regression | `POST /api/analyze-sheet` | **PASS**: Note count matches 1-page PDF (129 notes) |
| Interactive Note Recalculation | `POST /api/recalculate-score` | **PASS**: `C4` edited to `G4` -> solfa recomputed to `Sol` |
| Genuine MP3 Audio Export | `POST /api/export-audio` | **PASS**: `ffprobe` verified `codec_name: "mp3"`, `sample_rate: 44100` |
| Genuine WAV Audio Export | `POST /api/export-audio` | **PASS**: `ffprobe` verified `codec_name: "pcm_s16le"`, `44100 Hz` |
| AssemblyAI Consent Enforcement | `POST /api/voice-assistant/ask` | **PASS**: Rejects unconsented voice audio with `CONSENT_REQUIRED` |
| AssemblyAI Graceful Degradation | `POST /api/voice-assistant/ask` | **PASS**: Safe notice when key unset; typed Q&A with SmolLM2 works |
| SmolLM2 Grounded Q&A | `POST /api/voice-assistant/ask` | **PASS**: Answers questions referencing corrected score notes |

---

## 8. Known Limitations & Troubleshooting

1. **Scanned Score Image Quality**: Low-contrast, skewed, or handwritten scores can reduce OMR accuracy. ChoirMate AI surfaces uncertain measures rather than inventing notes.
2. **CPU Inference Latency**: SmolLM2 runs locally on CPU; inference takes 2–4 seconds on modern multi-core processors.
3. **Voice Audio Format**: Voice transcription uses WebM/MP4 audio recorded through the browser's `MediaRecorder` API. Ensure microphone permissions are granted.

---

## 9. License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** to comply with upstream OMR dependencies. See `LICENSE` and `THIRD_PARTY_NOTICES.md` for full details.
