#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = "--docker" ]; then
  exec docker compose -f "$ROOT_DIR/docker-compose.yml" up --build
fi

NEED_SETUP=0
if [ "${1:-}" = "--setup" ]; then
  NEED_SETUP=1
elif [ ! -x "$ROOT_DIR/engine/build/deadlock_engine" ] \
  || [ ! -x "$ROOT_DIR/backend/.venv/bin/python" ] \
  || [ ! -d "$ROOT_DIR/frontend/node_modules" ]; then
  NEED_SETUP=1
fi

if [ "$NEED_SETUP" -eq 1 ]; then
  "$ROOT_DIR/scripts/setup.sh"
fi

exec "$ROOT_DIR/scripts/dev.sh"
