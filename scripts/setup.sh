#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Deadlock City Environment Setup ==="
echo "Project root: $ROOT_DIR"

for cmd in cmake python3 node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Missing required dependency '$cmd' on PATH." >&2
    exit 1
  fi
done

if ! command -v c++ >/dev/null 2>&1 && ! command -v g++ >/dev/null 2>&1 && ! command -v clang++ >/dev/null 2>&1; then
  echo "ERROR: Missing a C++17 compiler (c++, g++, or clang++)." >&2
  exit 1
fi

CPU_CORES="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

echo "[1/3] Building C++17 simulation engine..."
CMAKE_ARGS=(-S "$ROOT_DIR/engine" -B "$ROOT_DIR/engine/build" -DCMAKE_BUILD_TYPE=Release)
if [ -d "$ROOT_DIR/engine/build/_deps/nlohmann_json-src" ]; then
  CMAKE_ARGS+=("-DFETCHCONTENT_SOURCE_DIR_NLOHMANN_JSON=$ROOT_DIR/engine/build/_deps/nlohmann_json-src")
fi
if [ -d "$ROOT_DIR/engine/build/_deps/googletest-src" ]; then
  CMAKE_ARGS+=("-DFETCHCONTENT_SOURCE_DIR_GOOGLETEST=$ROOT_DIR/engine/build/_deps/googletest-src")
fi
cmake "${CMAKE_ARGS[@]}"
cmake --build "$ROOT_DIR/engine/build" -j"$CPU_CORES"

echo "[2/3] Setting up FastAPI Python virtual environment..."
VENV_DIR="$ROOT_DIR/backend/.venv"
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/backend/requirements.txt"

echo "[3/3] Installing frontend dependencies and building assets..."
(
  cd "$ROOT_DIR/frontend"
  if [ -f "package-lock.json" ]; then
    npm ci
  else
    npm install
  fi
  npm run build
)

echo "Setup complete. Run ./scripts/test.sh or ./scripts/dev.sh next."
