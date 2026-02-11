#!/usr/bin/env bash
set -euo pipefail

# Generate openapi.json by starting the server, fetching /api/docs/json, then stopping.
# Run from repo root. Requires server to be built (pnpm run build).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

OPENAPI_JSON="${1:-$REPO_ROOT/openapi.json}"
PORT="${PORT:-3001}"

# Use a unique temp dir so each run starts with a clean DB (avoids migration conflicts)
CI_DATA="$(mktemp -d)"
CI_SECRETS="$(mktemp -d)"
trap 'rm -rf "$CI_DATA" "$CI_SECRETS"' EXIT

# Start server in background
export DATA_DIR="$CI_DATA"
export SECRETS_DIR="$CI_SECRETS"
export PORT
node server/dist/app.js &
SERVER_PID=$!

# Wait for server to be ready
for i in {1..30}; do
  if curl -sf "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server exited unexpectedly"
    exit 1
  fi
  sleep 0.5
done

curl -sf "http://127.0.0.1:$PORT/api/docs/json" -o "$OPENAPI_JSON"
kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

echo "Wrote $OPENAPI_JSON"
