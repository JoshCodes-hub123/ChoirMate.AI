@echo off
setlocal EnableDelayedExpansion
title ChoirMate AI — Everyday One-Click Startup (Windows HOMR + Secure Tunnel)

echo ============================================================================
echo   ChoirMate AI — Everyday Startup (start-choirmate.bat)
echo   Reuses installed .venv and cached HOMR weights (no reinstall/redownload).
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
REM Step 1: Fast Prerequisite & Configuration Check (No pip install / downloads)
REM ----------------------------------------------------------------------------
set VENV_PY=.venv\Scripts\python.exe

if not exist "%VENV_PY%" (
    echo [ERROR] Python virtual environment (.venv) not found.
    echo         Please double-click setup-choirmate.bat once to install dependencies first.
    pause
    exit /b 1
)

if not exist ".venv\.choirmate_setup_complete" (
    echo [ERROR] One-time setup has not been completed yet.
    echo         Please run setup-choirmate.bat once to prepare HOMR weights and configuration.
    pause
    exit /b 1
)

if not exist ".env.windows.local" (
    echo [ERROR] Missing .env.windows.local configuration file.
    echo         Please run setup-choirmate.bat to generate .env.windows.local.
    pause
    exit /b 1
)

REM Load key=value settings from .env.windows.local without echoing secrets
for /f "usebackq tokens=1,* delims==" %%A in (".env.windows.local") do (
    set "LINE=%%A"
    if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        set "VAL=%%B"
        if defined VAL (
            set "VAL=!VAL:"=!"
        )
        set "%%A=!VAL!"
    )
)

if not defined PYTHON_HOST set PYTHON_HOST=127.0.0.1
if not defined PYTHON_PORT set PYTHON_PORT=5001

if not defined PYTHON_SERVICE_SECRET (
    echo [ERROR] PYTHON_SERVICE_SECRET is empty in .env.windows.local.
    echo         Refusing to start an unauthenticated backend over a remote tunnel.
    echo         Run setup-choirmate.bat or set PYTHON_SERVICE_SECRET in .env.windows.local.
    pause
    exit /b 1
)

echo [1/3] Verifying cached HOMR environment in .venv...
"%VENV_PY%" -c "import homr, cv2, PIL, numpy, scipy, pypdfium2, onnxruntime, fastapi, uvicorn" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Required Python packages are missing or corrupted in .venv.
    echo         Please re-run setup-choirmate.bat to repair the environment.
    pause
    exit /b 1
)
echo [OK]  Cached Python environment and HOMR dependencies verified.

REM ----------------------------------------------------------------------------
REM Step 2: Start Local Python Backend on Loopback Only (127.0.0.1:5001)
REM ----------------------------------------------------------------------------
echo.
echo [2/3] Checking ChoirMate Python service on http://127.0.0.1:%PYTHON_PORT%...

"%VENV_PY%" -c "import os, sys, urllib.request, json; req = urllib.request.Request(f'http://127.0.0.1:{os.environ.get(\"PYTHON_PORT\",\"5001\")}/health', headers={'X-ChoirMate-Secret': os.environ.get('PYTHON_SERVICE_SECRET','')}); r = urllib.request.urlopen(req, timeout=2); d = json.loads(r.read().decode()); sys.exit(0 if d.get('omrAvailable') else 1)" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK]  ChoirMate Python HOMR service is already running and healthy on 127.0.0.1:%PYTHON_PORT%.
) else (
    echo       Starting ChoirMate Python HOMR service on 127.0.0.1:%PYTHON_PORT%...
    start "ChoirMate Python HOMR Service (127.0.0.1:%PYTHON_PORT%)" /min "%VENV_PY%" -m uvicorn python.service:app --host 127.0.0.1 --port %PYTHON_PORT%

    set BACKEND_READY=0
    for /L %%i in (1,1,15) do (
        if "!BACKEND_READY!"=="0" (
            timeout /t 1 /nobreak >nul
            "%VENV_PY%" -c "import os, sys, urllib.request, json; req = urllib.request.Request(f'http://127.0.0.1:{os.environ.get(\"PYTHON_PORT\",\"5001\")}/health', headers={'X-ChoirMate-Secret': os.environ.get('PYTHON_SERVICE_SECRET','')}); r = urllib.request.urlopen(req, timeout=2); d = json.loads(r.read().decode()); sys.exit(0 if (d.get('status')=='ok' and d.get('omrAvailable') and d.get('authRequired')) else 1)" >nul 2>nul
            if !ERRORLEVEL! equ 0 (
                set BACKEND_READY=1
            )
        )
    )

    if "!BACKEND_READY!"=="0" (
        echo [ERROR] Python HOMR service failed to start or did not pass the authenticated health check on 127.0.0.1:%PYTHON_PORT%.
        echo         Check the "ChoirMate Python HOMR Service" window for error details.
        pause
        exit /b 1
    )
    echo [OK]  Python HOMR service is online, authenticated, and ready on 127.0.0.1:%PYTHON_PORT%.
)

REM ----------------------------------------------------------------------------
REM Step 3: Start Stable Authenticated HTTPS Tunnel (Exposing ONLY 127.0.0.1:5001)
REM ----------------------------------------------------------------------------
echo.
echo [3/3] Starting secure HTTPS tunnel to http://127.0.0.1:%PYTHON_PORT%...

if defined CLOUDFLARE_TUNNEL_TOKEN (
    where cloudflared >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] CLOUDFLARE_TUNNEL_TOKEN is configured, but 'cloudflared' is not installed in PATH.
        echo         Install with: winget install -e --id Cloudflare.cloudflared
        pause
        exit /b 1
    )
    echo [OK]  Connecting permanent Cloudflare Named Tunnel to http://127.0.0.1:%PYTHON_PORT%...
    cloudflared tunnel --no-autoupdate run --token "%CLOUDFLARE_TUNNEL_TOKEN%" --url http://127.0.0.1:%PYTHON_PORT%
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Cloudflare Named Tunnel exited with an error. Check your CLOUDFLARE_TUNNEL_TOKEN in .env.windows.local.
        pause
        exit /b 1
    )
    goto :eof
)

if defined CLOUDFLARE_TUNNEL_NAME (
    where cloudflared >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] CLOUDFLARE_TUNNEL_NAME is configured, but 'cloudflared' is not installed in PATH.
        echo         Install with: winget install -e --id Cloudflare.cloudflared
        pause
        exit /b 1
    )
    echo [OK]  Connecting permanent Cloudflare Tunnel "%CLOUDFLARE_TUNNEL_NAME%" to http://127.0.0.1:%PYTHON_PORT%...
    cloudflared tunnel --no-autoupdate --url http://127.0.0.1:%PYTHON_PORT% run "%CLOUDFLARE_TUNNEL_NAME%"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Cloudflare Tunnel "%CLOUDFLARE_TUNNEL_NAME%" exited with an error.
        pause
        exit /b 1
    )
    goto :eof
)

if defined NGROK_STATIC_DOMAIN (
    where ngrok >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] NGROK_STATIC_DOMAIN is configured, but 'ngrok' is not installed in PATH.
        echo         Install with: winget install -e --id Ngrok.Ngrok
        pause
        exit /b 1
    )
    echo [OK]  Connecting permanent ngrok static HTTPS domain https://%NGROK_STATIC_DOMAIN% -^> http://127.0.0.1:%PYTHON_PORT%...
    ngrok http --url=%NGROK_STATIC_DOMAIN% 127.0.0.1:%PYTHON_PORT%
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] ngrok static tunnel failed. Ensure you ran 'ngrok config add-authtoken YOUR_TOKEN' and that NGROK_STATIC_DOMAIN is valid.
        pause
        exit /b 1
    )
    goto :eof
)

if "%ALLOW_TEMPORARY_TUNNEL%"=="1" (
    where cloudflared >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo [WARN] Starting temporary Cloudflare Quick Tunnel (URL changes on restart)...
        cloudflared tunnel --no-autoupdate --url http://127.0.0.1:%PYTHON_PORT%
        goto :eof
    )
    where ngrok >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        echo [WARN] Starting temporary ngrok tunnel (URL changes on restart)...
        ngrok http 127.0.0.1:%PYTHON_PORT%
        goto :eof
    )
)

echo.
echo [ERROR] No permanent HTTPS tunnel is configured in .env.windows.local!
echo.
echo To prevent your tunnel address from changing every time the laptop restarts,
echo open .env.windows.local in Notepad and set ONE of the following:
echo.
echo   Option A (Recommended - Free Static Ngrok Domain):
echo     1. Claim your free static domain at https://dashboard.ngrok.com/domains
echo     2. Authenticate once: ngrok config add-authtoken ^<YOUR_NGROK_AUTHTOKEN^>
echo     3. Set in .env.windows.local:
echo        NGROK_STATIC_DOMAIN=your-permanent-name.ngrok-free.app
echo.
echo   Option B (Cloudflare Zero Trust Named Tunnel):
echo     1. Create a tunnel in Cloudflare Zero Trust -> Networks -> Tunnels
echo     2. Set in .env.windows.local:
echo        CLOUDFLARE_TUNNEL_TOKEN=^<YOUR_TUNNEL_TOKEN^>
echo.
echo ^( Python HOMR service is currently running locally on http://127.0.0.1:%PYTHON_PORT% ^)
pause
exit /b 1
