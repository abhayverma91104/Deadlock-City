#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
ENGINE_BIN="$ROOT_DIR/engine/build/deadlock_engine"
VENV_PY="$ROOT_DIR/backend/.venv/bin/python"

if [ ! -x "$ENGINE_BIN" ]; then
  echo "ERROR: C++ engine binary not found at '$ENGINE_BIN'. Run ./scripts/setup.sh first." >&2
  exit 1
fi
if [ ! -x "$VENV_PY" ]; then
  echo "ERROR: Backend virtualenv missing at '$VENV_PY'. Run ./scripts/setup.sh first." >&2
  exit 1
fi
if [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  echo "ERROR: Frontend dependencies missing. Run ./scripts/setup.sh first." >&2
  exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down Deadlock City dev services..."
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM EXIT

export DEADLOCK_ENGINE_PATH="$ENGINE_BIN"

echo "Starting FastAPI backend at http://$BACKEND_HOST:$BACKEND_PORT ..."
(
  cd "$ROOT_DIR/backend"
  exec "$ROOT_DIR/backend/.venv/bin/uvicorn" app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

echo "Waiting for backend health check..."
READY=0
for _ in $(seq 1 30); do
  if "$VENV_PY" -c "import urllib.request; urllib.request.urlopen('http://$BACKEND_HOST:$BACKEND_PORT/api/health', timeout=1)" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: Backend failed to become healthy within 15s." >&2
  exit 1
fi

echo "Starting Vite frontend at http://127.0.0.1:$FRONTEND_PORT ..."
npm --prefix "$ROOT_DIR/frontend" run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

echo "Deadlock City running:"
echo "  Frontend: http://127.0.0.1:$FRONTEND_PORT"
echo "  Backend:  http://$BACKEND_HOST:$BACKEND_PORT/api/health"
echo "Press Ctrl+C to stop."

wait "$FRONTEND_PID" "$BACKEND_PID"
