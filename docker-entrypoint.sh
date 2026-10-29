#!/usr/bin/env bash
set -e

echo "=========================================================="
echo " Starting ChoirMate AI Production Container (Node + Python)"
echo " Environment Port: ${PORT:-3000}"
echo "=========================================================="

# Trap termination signals to kill both processes cleanly
cleanup() {
    echo "[Container Entrypoint] Received termination signal. Cleaning up child processes..."
    if [ -n "$PY_PID" ]; then
        kill -TERM "$PY_PID" 2>/dev/null || true
    fi
    if [ -n "$NODE_PID" ]; then
        kill -TERM "$NODE_PID" 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    echo "[Container Entrypoint] Shutdown complete."
    exit 0
}

trap cleanup SIGTERM SIGINT

# 1. Start Python Open-Weight Microservice on internal port 5001
echo "[Container Entrypoint] Starting Python FastAPI service on 127.0.0.1:5001..."
python3 -m uvicorn python.service:app --host 127.0.0.1 --port 5001 &
PY_PID=$!

# 2. Health check wait loop: Ensure Python is ready before opening Node.js traffic
echo "[Container Entrypoint] Waiting for Python OMR & SmolLM2 service to be ready..."
READY=0
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:5001/health >/dev/null 2>&1; then
        echo "[Container Entrypoint] Python service is healthy and ready!"
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" -ne 1 ]; then
    echo "[Container Entrypoint] Warning: Python service did not become healthy within 30s. Node.js server will proceed with self-healing daemon management."
fi

# 3. Start Node.js Express Application listening on $PORT
echo "[Container Entrypoint] Starting Express server on port ${PORT:-3000}..."
npm start &
NODE_PID=$!

# Wait for either process to terminate
wait -n "$PY_PID" "$NODE_PID"
EXIT_CODE=$?

echo "[Container Entrypoint] One of the primary services exited with code ${EXIT_CODE}. Shutting down container..."
cleanup
