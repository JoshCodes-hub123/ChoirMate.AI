@echo off
setlocal EnableDelayedExpansion
title ChoirMate AI — One-Time Windows HOMR Setup ^& Validation

echo ============================================================================
echo   ChoirMate AI — One-Time Windows Setup (setup-choirmate.bat)
echo   Installs dependencies, caches HOMR weights, and configures security.
echo ============================================================================
echo.

cd /d "%~dp0"
if not exist "python\service.py" (
    if exist "..\python\service.py" (
        cd /d "%~dp0.."
    ) else (
        echo [ERROR] Could not locate python\service.py. Run this file from the ChoirMate AI repository folder.
        pause
        exit /b 1
    )
)

REM ----------------------------------------------------------------------------
REM Step 1: Verify Python 3 (64-bit, 3.10 - 3.12) & System Tools
REM ----------------------------------------------------------------------------
echo [1/5] Checking Windows system prerequisites...
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Python 3 is not installed or not in your Windows PATH.
    echo         Install 64-bit Python 3.11 via PowerShell:
    echo           winget install -e --id Python.Python.3.11
    echo         Or download from https://www.python.org/downloads/windows/
    echo         ^(Make sure "Add python.exe to PATH" is checked.^)
    pause
    exit /b 1
)

python -c "import sys, struct; ok = (sys.version_info[:2] >= (3, 10) and struct.calcsize('P') * 8 == 64); sys.exit(0 if ok else 1)"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] ChoirMate HOMR requires 64-bit Python 3.10, 3.11, or 3.12.
    python --version
    pause
    exit /b 1
)

where ffmpeg >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARN]  ffmpeg was not found in PATH. WAV audio works natively, but MP3 export requires ffmpeg.
    echo         Install with: winget install -e --id Gyan.FFmpeg
) else (
    echo [OK]    ffmpeg detected in PATH.
)

set HAS_TUNNEL=0
where cloudflared >nul 2>nul
if %ERRORLEVEL% equ 0 set HAS_TUNNEL=1
where ngrok >nul 2>nul
if %ERRORLEVEL% equ 0 set HAS_TUNNEL=1
if "!HAS_TUNNEL!"=="0" (
    echo [WARN]  Neither 'cloudflared' nor 'ngrok' was found in PATH.
    echo         Install one for secure HTTPS tunneling to Vercel:
    echo           winget install -e --id Cloudflare.cloudflared
    echo           winget install -e --id Ngrok.Ngrok
) else (
    echo [OK]    HTTPS tunnel client detected in PATH.
)

REM ----------------------------------------------------------------------------
REM Step 2: Create Virtual Environment (.venv) & Install Python Dependencies
REM ----------------------------------------------------------------------------
echo.
echo [2/5] Preparing Python virtual environment (.venv)...
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to create Python virtual environment in .venv.
        pause
        exit /b 1
    )
)

set VENV_PY=.venv\Scripts\python.exe

echo       Upgrading pip and installing python\requirements.txt...
"%VENV_PY%" -m pip install --upgrade pip
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to upgrade pip in .venv.
    pause
    exit /b 1
)

"%VENV_PY%" -m pip install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu -r python\requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies from python\requirements.txt.
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------------
REM Step 3: Download & Cache HOMR ONNX Optical Music Recognition Weights Once
REM ----------------------------------------------------------------------------
echo.
echo [3/5] Downloading and verifying HOMR ONNX model weights (cached locally)...
"%VENV_PY%" -c "from homr.main import download_weights; download_weights(False); print('[OK] HOMR ONNX model weights are cached locally.')"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to download or verify HOMR ONNX model weights.
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------------
REM Step 4: Configure Local Security & Stable Tunnel (.env.windows.local)
REM ----------------------------------------------------------------------------
echo.
echo [4/5] Configuring .env.windows.local (git-ignored security ^& tunnel config)...
"%VENV_PY%" -c "import os, secrets; p = '.env.windows.local'; exists = os.path.isfile(p); content = open(p, 'r', encoding='utf-8').read() if exists else ''; has_sec = ('PYTHON_SERVICE_SECRET=' in content and len([l for l in content.splitlines() if l.strip().startswith('PYTHON_SERVICE_SECRET=') and len(l.split('=',1)[1].strip().strip('\"')) >= 16]) > 0); sec = secrets.token_hex(32); tpl = f'# ChoirMate AI - Local Windows HOMR Server Configuration (NEVER COMMIT TO GIT)\nPYTHON_HOST=127.0.0.1\nPYTHON_PORT=5001\nPYTHON_SERVICE_SECRET={sec}\nSMOLLM2_MODEL_PATH=python\\models\\SmolLM2-360M-Instruct-Q4_K_M.gguf\n\n# Stable Authenticated HTTPS Tunnel Configuration (Set ONE of the two options below):\n# Option A: Ngrok Free Static Domain (from https://dashboard.ngrok.com/domains)\n# Example: NGROK_STATIC_DOMAIN=your-permanent-name.ngrok-free.app\nNGROK_STATIC_DOMAIN=\n\n# Option B: Cloudflare Named Tunnel Token (from Cloudflare Zero Trust Dashboard)\nCLOUDFLARE_TUNNEL_TOKEN=\nCLOUDFLARE_TUNNEL_NAME=\n\n# Set ALLOW_TEMPORARY_TUNNEL=1 only if you want a temporary URL while testing\nALLOW_TEMPORARY_TUNNEL=0\n'; open(p, 'w', encoding='utf-8').write(tpl) if not has_sec else None"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Could not write .env.windows.local configuration file.
    pause
    exit /b 1
)

REM ----------------------------------------------------------------------------
REM Step 5: Validate Full Python Engine & Write Completion Marker
REM ----------------------------------------------------------------------------
echo.
echo [5/5] Running end-to-end validation of ChoirMate Python HOMR service...
"%VENV_PY%" -c "import sys; sys.path.insert(0, 'python'); import service; h = service.health(); print(f'      omrAvailable={h[\"omrAvailable\"]}, pdfSupport={h[\"pdfSupport\"]}, authRequired={h[\"authRequired\"]}'); sys.exit(0 if (h['omrAvailable'] and h['pdfSupport'] and h['authRequired']) else 1)"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Validation failed: HOMR, PDF support, or PYTHON_SERVICE_SECRET is not active.
    pause
    exit /b 1
)

echo setup_verified=1 > ".venv\.choirmate_setup_complete"

echo.
echo ============================================================================
echo   SETUP COMPLETE! ChoirMate AI Windows HOMR Engine is ready.
echo ============================================================================
echo.
echo   1. Open .env.windows.local in Notepad to view your generated
echo      PYTHON_SERVICE_SECRET and set your permanent tunnel address:
echo        - NGROK_STATIC_DOMAIN=your-static-domain.ngrok-free.app
echo          ^(or CLOUDFLARE_TUNNEL_TOKEN=...^)
echo.
echo   2. In your Vercel Project Settings -^> Environment Variables, set:
echo        - PYTHON_SERVICE_URL    = https://your-static-domain.ngrok-free.app
echo        - PYTHON_SERVICE_SECRET = ^(exact value from .env.windows.local^)
echo.
echo   3. For everyday use, simply double-click:
echo        start-choirmate.bat
echo ============================================================================
pause
