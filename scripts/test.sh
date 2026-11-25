#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== [1/5] Running C++17 CTest Suite ==="
ctest --test-dir "$ROOT_DIR/engine/build" --output-on-failure

echo "=== [2/5] Running FastAPI Pytest Suite ==="
(
  cd "$ROOT_DIR/backend"
  "$ROOT_DIR/backend/.venv/bin/pytest" tests -q
)

echo "=== [3/5] Running Frontend ESLint ==="
npm --prefix "$ROOT_DIR/frontend" run lint

echo "=== [4/5] Running Frontend Vitest Suite ==="
npm --prefix "$ROOT_DIR/frontend" test

echo "=== [5/5] Running Frontend Production Build ==="
npm --prefix "$ROOT_DIR/frontend" run build

echo "All Deadlock City test & build suites passed."
