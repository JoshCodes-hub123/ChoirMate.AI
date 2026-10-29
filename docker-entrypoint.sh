#!/usr/bin/env bash
set -e

echo "=========================================================="
echo " Starting ChoirMate AI Production Container (Node + Python)"
echo " Environment Port: ${PORT:-3000}"
echo "=========================================================="

# 1. Start Python Open-Weight Microservice in background on port 5001 (non-blocking)
echo "[Container Entrypoint] Starting Python FastAPI service on 127.0.0.1:5001..."
python3 -m uvicorn python.service:app --host 127.0.0.1 --port 5001 &
PY_PID=$!

# 2. Start Node.js Express application in foreground (exec) so it binds to $PORT immediately
# This satisfies Cloud Run and container platform startup health probe requirements instantly.
echo "[Container Entrypoint] Starting Node.js server on port ${PORT:-3000}..."
exec node --max-old-space-size=256 dist/server.js
