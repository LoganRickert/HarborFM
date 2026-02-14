#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${E2E_PORT:-3099}"
WEBRTC_PORT="${WEBRTC_PORT:-3098}"

export E2E_PORT="$PORT"
export E2E_BASE_URL="http://127.0.0.1:$PORT/api"
export E2E_DATA_DIR="$E2E_DIR/data"
export E2E_SECRETS_DIR="$E2E_DIR/secrets"

# WebRTC env for server and start-webrtc.sh
export WEBRTC_PORT="$WEBRTC_PORT"
export WEBRTC_SERVICE_URL="http://127.0.0.1:$WEBRTC_PORT"
export WEBRTC_PUBLIC_WS_URL="ws://localhost:$WEBRTC_PORT"
export RECORDING_CALLBACK_SECRET="e2e-secret"
export MAIN_APP_BASE_URL="http://127.0.0.1:$PORT"

# Clean and create data/secrets
rm -rf "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"
mkdir -p "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports" "$E2E_DIR/assets"

# Create sine-wave WAV for Chromium --use-file-for-fake-audio-capture (real audio frames for mediasoup)
if command -v ffmpeg &>/dev/null; then
  ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ac 1 -ar 48000 -y "$E2E_DIR/assets/fake-mic.wav" 2>/dev/null || true
fi

# Build web and ensure server/public exists for Playwright to load the app
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
pnpm --filter shared run build 2>/dev/null || true
pnpm --filter web run build 2>/dev/null || true
mkdir -p "$ROOT/server/public"
cp -R "$ROOT/web/dist/"* "$ROOT/server/public/" 2>/dev/null || true
export PUBLIC_DIR="$ROOT/server/public"

# Pre-create setup token
echo "e2e-setup-token-$(openssl rand -hex 16)" > "$E2E_DIR/data/setup-token.txt"

# Start server (with webrtc env)
bash "$SCRIPT_DIR/start-server.sh"

# Start webrtc
bash "$SCRIPT_DIR/start-webrtc.sh"

# Ensure Playwright browsers are installed, then run tests
cd "$E2E_DIR"
pnpm exec playwright install chromium
EXIT_CODE=0
# WebRTC test runs headed (for reliable fake device). Use xvfb when no display (SSH, CI).
if [ -z "${DISPLAY:-}" ]; then
  if command -v xvfb-run &>/dev/null; then
    xvfb-run pnpm exec playwright test || EXIT_CODE=$?
  else
    echo "Error: Headed browser requires a display. Install xvfb and rerun, or run with DISPLAY set:" >&2
    echo "  apt install xvfb   # Debian/Ubuntu" >&2
    echo "  xvfb-run pnpm run e2e:webrtc" >&2
    exit 1
  fi
else
  pnpm exec playwright test || EXIT_CODE=$?
fi

# Stop webrtc and server
bash "$SCRIPT_DIR/stop-webrtc.sh"
bash "$SCRIPT_DIR/stop-server.sh"

exit $EXIT_CODE
