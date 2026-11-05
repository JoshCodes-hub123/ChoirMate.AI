# ChoirMate AI — Windows Laptop HOMR Server & Vercel Deployment Guide

This guide documents the production-ready workflow for running ChoirMate AI's **Python HOMR (Optical Music Recognition)** engine on your **Windows laptop** and connecting it securely to **Vercel** (and **Google AI Studio**).

---

## 1. End-to-End Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Public Users (Web / Mobile)                         │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ HTTPS (Same-Origin /api/*)
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│              Vercel Web Application / Google AI Studio Server              │
│  - Frontend: React + Vite (calls same-origin `/api/*` only)                │
│  - Server Proxy: `/api/[...route].ts` (Vercel) or `server.ts` (Express)    │
│  - Injects `X-ChoirMate-Secret: <PYTHON_SERVICE_SECRET>` server-side       │
│  - Private tunnel URLs and secrets are NEVER exposed to the browser        │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │ Permanent Authenticated HTTPS Tunnel
                                      │ (ngrok Static Domain / Cloudflare Named Tunnel)
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   Windows Laptop — Python HOMR Server                      │
│  - `python/service.py` bound strictly to loopback `127.0.0.1:5001`         │
│  - Constant-time `hmac.compare_digest` verification of `X-ChoirMate-Secret`│
│  - `python/omr_engine.py` (HOMR 0.6.2 + OpenCV + ONNX Runtime)             │
│  - `python/pdf_processor.py` (pypdfium2 multi-page PDF renderer)           │
│  - `python/music_theory.py` (MusicXML parser + Movable-Do Solfa)           │
│  - `python/voice_studio.py` & `python/voice_audio.py` (SATB synthesis)     │
│  - `python/audio_exporter.py` (WAV + FFmpeg MP3 synthesis)                 │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Two-Script Windows Workflow (Install Once vs. Everyday One-Click Startup)

To ensure everyday startup is fast and never reinstalls packages or redownloads model weights, the Windows workflow is split into two root batch files:

| Script | When to Run | What It Does |
| :--- | :--- | :--- |
| **`setup-choirmate.bat`** | **Run ONCE** (or after updating `requirements.txt`) | 1. Checks 64-bit Python 3.10–3.12, `ffmpeg`, and `ngrok`/`cloudflared`.<br>2. Creates `.venv` and installs `python\requirements.txt`.<br>3. Downloads & caches HOMR ONNX model weights locally.<br>4. Generates a 64-character random `PYTHON_SERVICE_SECRET` in `.env.windows.local` (git-ignored).<br>5. Validates `python/service.py` (`omrAvailable=True`, `pdfSupport=True`, `authRequired=True`) and writes `.venv\.choirmate_setup_complete`. |
| **`start-choirmate.bat`** | **Everyday One-Click Startup** | 1. Verifies `.venv\.choirmate_setup_complete` and `.env.windows.local` (no `pip install`, no weight downloads).<br>2. Starts `uvicorn python.service:app` bound strictly to `127.0.0.1:5001`.<br>3. Verifies `/health` with `X-ChoirMate-Secret`.<br>4. Launches your permanent authenticated HTTPS tunnel to `127.0.0.1:5001` and reports clear errors if either fails. |

---

## 3. One-Time Windows Laptop Setup

### Step 1: Install System Prerequisites (PowerShell)
```powershell
# 1. 64-bit Python 3.11
winget install -e --id Python.Python.3.11

# 2. FFmpeg (required for MP3 practice audio export)
winget install -e --id Gyan.FFmpeg

# 3. Tunnel client (pick ONE: ngrok Static Domain OR Cloudflare Named Tunnel)
winget install -e --id Ngrok.Ngrok
# OR:
winget install -e --id Cloudflare.cloudflared
```

### Step 2: Run `setup-choirmate.bat` Once
Double-click **`setup-choirmate.bat`** in the repository root.
When it finishes, it creates **`.env.windows.local`** (which is listed in `.gitignore` so your secrets can never be committed to GitHub).

### Step 3: Configure a Permanent HTTPS Tunnel in `.env.windows.local`
Open `.env.windows.local` in Notepad. You will see your auto-generated `PYTHON_SERVICE_SECRET`. Configure **one** permanent tunnel option so your URL never changes when you restart your laptop:

#### Option A: Ngrok Free Static Domain (Simplest Permanent URL)
1. Sign in to [dashboard.ngrok.com](https://dashboard.ngrok.com) and run your authtoken command once in Command Prompt:
   ```cmd
   ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
   ```
2. Go to **Domains** in the ngrok dashboard and claim your 1 free permanent static domain (e.g., `choirmate-homr.ngrok-free.app`).
3. Set in `.env.windows.local`:
   ```ini
   NGROK_STATIC_DOMAIN=choirmate-homr.ngrok-free.app
   ```

#### Option B: Cloudflare Zero Trust Named Tunnel
1. In the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com) → **Networks** → **Tunnels**, create a tunnel and point a public hostname to `http://127.0.0.1:5001`.
2. Copy the tunnel token and set in `.env.windows.local`:
   ```ini
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
   ```

---

## 4. Configure Vercel Environment Variables (One-Time)

In your **Vercel Project Dashboard → Settings → Environment Variables**, add:

| Variable Name | Value | Environments |
| :--- | :--- | :--- |
| `PYTHON_SERVICE_URL` | `https://choirmate-homr.ngrok-free.app` *(your permanent HTTPS tunnel URL)* | Production, Preview, Development |
| `PYTHON_SERVICE_SECRET` | *(exact 64-char secret from `.env.windows.local`)* | Production, Preview, Development |

*(Never prefix these with `VITE_`. They remain strictly inside Vercel's server-side `/api/[...route].ts` function.)*

---

## 5. Everyday Usage

1. Turn on your Windows laptop.
2. Double-click **`start-choirmate.bat`**.
3. Within ~3 seconds, the local Python HOMR server (`127.0.0.1:5001`) and your permanent HTTPS tunnel are online and authenticated.
