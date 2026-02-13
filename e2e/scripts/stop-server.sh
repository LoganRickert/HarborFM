#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${E2E_PORT:-3099}"

if [ -f "$E2E_DIR/server.pid" ]; then
  PID=$(cat "$E2E_DIR/server.pid")
  kill "$PID" 2>/dev/null || true
  rm -f "$E2E_DIR/server.pid"
fi

# Fallback: kill by port
lsof -t -i ":$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true

# Remove e2e data directory so the next run starts fresh
rm -rf "$E2E_DIR/data"
rm -rf "$E2E_DIR/secrets"
