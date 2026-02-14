#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
PORT="${E2E_PORT:-3099}"
export DATA_DIR="$E2E_DIR/data"
export SECRETS_DIR="$E2E_DIR/secrets"
export PORT
export NODE_ENV="${NODE_ENV:-development}"
export RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-2000}"
export RATE_LIMIT_TIME_WINDOW="${RATE_LIMIT_TIME_WINDOW:-1 minute}"

echo "" > "$E2E_DIR/server.log"

# Ensure server is built
pnpm --filter server build 1>/dev/null 2>&1 || true

cd "$ROOT"

node server/dist/app.js 1>>"$E2E_DIR/server.log" 2>&1 &
echo $! > "$E2E_DIR/server.pid"

# Wait for health
for i in {1..30}; do
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q 200; then
    exit 0
  fi
  sleep 0.5
done
echo "Server did not become healthy in time" >&2
exit 1
