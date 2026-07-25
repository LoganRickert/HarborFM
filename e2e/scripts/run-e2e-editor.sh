#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"

PORT="${E2E_PORT:-3099}"
export E2E_PORT="$PORT"
export E2E_BASE_URL="http://127.0.0.1:$PORT/api"
export E2E_DATA_DIR="$E2E_DIR/data"
export E2E_SECRETS_DIR="$E2E_DIR/secrets"

# Clean and create data/secrets
rm -rf "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"
mkdir -p "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"

# Build web and ensure server/public exists for Playwright to load the app
pnpm --filter shared run build 2>/dev/null || true
pnpm --filter web run build 2>/dev/null || true
mkdir -p "$ROOT/server/public"
cp -R "$ROOT/web/dist/"* "$ROOT/server/public/" 2>/dev/null || true
export PUBLIC_DIR="$ROOT/server/public"

# Pre-create setup token
echo "e2e-setup-token-$(openssl rand -hex 16)" > "$E2E_DIR/data/setup-token.txt"

# Start API server (no mediasoup required for advanced editor UI)
bash "$SCRIPT_DIR/start-server.sh"

cd "$E2E_DIR"
pnpm exec playwright install chromium
EXIT_CODE=0

run_playwright() {
  if [ -z "${DISPLAY:-}" ]; then
    if command -v xvfb-run &>/dev/null; then
      xvfb-run pnpm exec playwright test -c playwright.editor.config.ts "$@"
    else
      echo "Error: Headed browser requires a display. Install xvfb and rerun, or run with DISPLAY set:" >&2
      echo "  apt install xvfb   # Debian/Ubuntu" >&2
      echo "  xvfb-run pnpm run e2e:editor" >&2
      exit 1
    fi
  else
    pnpm exec playwright test -c playwright.editor.config.ts "$@"
  fi
}

run_playwright "$@" 2>&1 | grep --line-buffered -v -E '^\[server\] '
EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -ne 0 ] && [ -f "$E2E_DIR/server.log" ]; then
  echo ""
  echo "=== Last 80 lines of server.log ==="
  tail -80 "$E2E_DIR/server.log"
fi

bash "$SCRIPT_DIR/stop-server.sh"
exit $EXIT_CODE
