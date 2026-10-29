# ChoirMate AI — Production Deployment Guide (Render + Vercel)

This guide provides instructions for deploying ChoirMate AI to production with:
- **Backend Service on Render**: Containerized Node.js + Python runtime running HOMR optical music recognition, MusicXML parsing, Movable-Do solfa, audio synthesis, and the local open-weight SmolLM2 vocal coach.
- **Frontend Application on Vercel**: High-performance static React/Vite SPA with responsive UI, real-time audio playback, and visual score inspection.

---

## 1. Architecture Overview

```
                      ┌───────────────────────────────────────────────┐
                      │               Vercel Frontend                 │
                      │         (React 19 + Vite 6 + Tailwind)        │
                      └──────────────────────┬────────────────────────┘
                                             │
               ┌─────────────────────────────┴────────────────────────────┐
               │ Same-Origin Proxy (/api/*) or Direct (VITE_API_URL)      │
               ▼                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Render Backend Container                              │
│                                                                                 │
│   ┌───────────────────────────┐           ┌─────────────────────────────────┐   │
│   │   Express Gateway (Node)  │ ◄───────► │   Python FastAPI Microservice   │   │
│   │   - Public Port $PORT     │ HTTP/IPC  │   - Internal 127.0.0.1:5001     │   │
│   │   - Rate Limit & Caching  │           │   - TrOMR / HOMR Engine         │   │
│   │   - Audio Stream Handler  │           │   - SmolLM2-360M-Instruct GGUF  │   │
│   │   - AssemblyAI Proxy      │           │   - FFmpeg / NumPy Audio Synth  │   │
│   └───────────────────────────┘           └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Part A: Deploying the Backend on Render

### Step 1: Create a New Web Service
1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Web Service**.
3. Connect your GitHub repository (`JoshCodes-hub123/choirmate-ai`).
4. Select branch `main`.

### Step 2: Choose Docker as the Runtime
- In the **Environment** dropdown, select **Docker**.
- Render will automatically locate the root `Dockerfile` and `docker-entrypoint.sh`.

### Step 3: Choose an Instance Plan (Important Sizing Requirements)
- **Minimum Instance**: **Starter** (1 GB RAM, 0.5 CPU) or **Standard** (2 GB RAM, 1 CPU).
- **Warning on Free Tier (512 MB RAM)**:
  - HOMR ONNX TrOMR segmentation + Staff2Score models require ~400–600 MB RAM during peak image inference.
  - The `SmolLM2-360M-Instruct-Q4_K_M.gguf` model binary is ~230 MB and requires ~350 MB RAM when initialized.
  - Running optical music recognition and language model inference simultaneously on a 512 MB free instance risks out-of-memory (OOM) termination. Choose at least 1 GB RAM for reliable operation.

### Step 4: Configure Environment Variables on Render
Add the following environment variables in the Render Dashboard under **Environment**:

| Variable Name | Recommended Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables optimized production caching & routing |
| `PORT` | *(Leave unset)* | Render dynamically injects `$PORT` (defaults to 3000 locally) |
| `PYTHON_SERVICE_URL` | `http://127.0.0.1:5001` | Private internal container URL for the Python service |
| `SMOLLM2_MODEL_PATH` | `/tmp/choirmate-models/SmolLM2-360M-Instruct-Q4_K_M.gguf` | Path where SmolLM2 GGUF is stored |
| `SMOLLM2_AUTO_DOWNLOAD` | `1` | Automatically downloads the required GGUF model on startup if not present |
| `CORS_ORIGIN` | `https://your-choirmate-app.vercel.app` | Allow cross-origin requests from your Vercel frontend domain |
| `ASSEMBLYAI_API_KEY` | *(Optional)* | Server-side key for spoken question speech-to-text. (Typed Q&A works without it) |

### Step 5: (Optional but Recommended) Persistent Disk for the Model
On standard Render web services, `/tmp` is wiped on restart or redeployment. To avoid re-downloading the 230 MB SmolLM2 model on cold starts:
1. In your Render Web Service settings, go to **Disks**.
2. Click **Add Disk**:
   - **Name**: `choirmate-data`
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB
3. Update your environment variable:
   - `SMOLLM2_MODEL_PATH=/var/data/models/SmolLM2-360M-Instruct-Q4_K_M.gguf`

### Step 6: Verify Render Deployment Logs & Health
Once deployed, inspect the service logs in Render:
```
[Container Entrypoint] Starting Python FastAPI service on 127.0.0.1:5001...
[Container Entrypoint] Waiting for Python OMR & SmolLM2 service to be ready...
[Container Entrypoint] Python service is healthy and ready!
[Container Entrypoint] Starting Express server on port 10000...
ChoirMate AI open-weight server running on http://0.0.0.0:10000
```
Verify the live health check in your browser or terminal:
```bash
curl https://YOUR-RENDER-SERVICE.onrender.com/api/health
```
Expected response:
```json
{
  "status": "ok",
  "openWeight": true,
  "pythonServiceActive": true,
  "modelLoaded": true,
  "recognitionEngine": "HOMR (Full-Score Optical Music Recognition)",
  "pdfSupport": true,
  "aiTeacher": "SmolLM2-360M-Instruct-GGUF"
}
```

---

## 3. Part B: Deploying the Frontend on Vercel

### Step 1: Import the Repository
1. Log in to [Vercel](https://vercel.com/).
2. Click **Add New...** -> **Project**.
3. Select your GitHub repository (`JoshCodes-hub123/choirmate-ai`).

### Step 2: Configure Framework & Build Settings
Vercel will detect Vite automatically:
- **Framework Preset**: `Vite`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

### Step 3: Configure Environment Variables & Proxy Routing
There are two ways to connect Vercel to your Render backend:

#### Option 1: Direct Backend URL via `VITE_API_URL` (Recommended)
Add this environment variable in Vercel settings under **Environment Variables**:
```
VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com
```
*Why this is recommended*: Vercel serverless/edge proxies enforce a strict **4.5 MB request payload limit**. Directly communicating with your Render backend allows uploading complete multi-page PDF choir scores (up to 25 MB) without Vercel 413 Payload Too Large errors.

#### Option 2: Same-Origin Proxy via `vercel.json`
If you prefer same-origin requests through `/api/*`, edit `vercel.json` and replace the placeholder with your actual Render service URL:
```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://YOUR-RENDER-SERVICE.onrender.com/api/$1"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

### Step 4: Deploy and Verify
Click **Deploy**. Once built, open your Vercel URL (e.g. `https://choirmate-ai.vercel.app`):
1. The hero section and family singing visual will load immediately.
2. Clicking **"Explore your first song"** will navigate smoothly to the multi-page score upload studio.
3. Clicking **"Open & Sing"** on any sample score will load full Movable-Do solfa notes, synthesized audio, and the local SmolLM2 vocal coach.

---

## 4. Local Development & Verification Commands

To run or test ChoirMate AI locally on your development machine:

```bash
# 1. Install Node.js dependencies
npm install

# 2. Install Python dependencies
pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu -r python/requirements.txt

# 3. Pre-download HOMR optical music recognition weights (runs once)
python3 -c "from homr.main import download_weights; download_weights(False)"

# 4. Run type-checking & linting
npm run lint

# 5. Build static client for production verification
npm run build

# 6. Start the complete full-stack development server
npm run dev
# Application will be accessible at http://localhost:3000
```

---

## 5. Troubleshooting & FAQ

### A. Python Dependency / `llama-cpp-python` Build Issues
- **Symptom**: `Failed to build llama-cpp-python` during `pip install`.
- **Cause**: Missing C++ compiler or trying to build from source on a machine without `cmake`.
- **Solution**: Use the pre-compiled CPU wheels index:
  ```bash
  pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu llama-cpp-python>=0.2.75
  ```

### B. Missing GGUF Model File on Cold Start
- **Symptom**: Model status in `/api/health` shows `modelLoaded: false`.
- **Cause**: Model binary has not yet finished downloading from Hugging Face into `SMOLLM2_MODEL_PATH`.
- **Solution**:
  1. Check `SMOLLM2_AUTO_DOWNLOAD=1` in your environment variables.
  2. The model (`SmolLM2-360M-Instruct-Q4_K_M.gguf`, ~230 MB) downloads automatically upon the first question or service start.
  3. For zero cold-start delay, attach a Render Persistent Disk (see Section 2, Step 5).

### C. Vercel 4.5 MB Payload Limit on PDF Uploads
- **Symptom**: Uploading a multi-page PDF sheet music returns `413 Payload Too Large` from Vercel.
- **Cause**: Vercel edge/serverless rewrites do not support request bodies larger than 4.5 MB.
- **Solution**: In your Vercel dashboard, set `VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com`. This sends uploads directly to the Render backend, supporting PDFs up to 25 MB.

### D. Audio Export (MP3) Error
- **Symptom**: WAV export succeeds, but MP3 export returns an error.
- **Cause**: `ffmpeg` is not installed on the system.
- **Solution**: Ensure FFmpeg is installed (`sudo apt-get install -y ffmpeg`). The provided production `Dockerfile` installs `ffmpeg` automatically.

### E. Render Service Cold Starts (Free Tier)
- On the Render Free tier, containers spin down after 15 minutes of inactivity. The first request may take 30–50 seconds to wake the container and load the Python service. Upgrading to the **Starter** ($7/mo) instance keeps the container warm permanently.
