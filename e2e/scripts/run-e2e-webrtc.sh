#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Kill any orphaned tail processes from previous runs that stream server/webrtc logs
pkill -f "tail -f.*server\.log" 2>/dev/null || true
pkill -f "tail -f.*webrtc\.log" 2>/dev/null || true

PORT="${E2E_PORT:-3099}"
WEBRTC_PORT="${WEBRTC_PORT:-3098}"

export E2E_PORT="$PORT"
export E2E_BASE_URL="http://127.0.0.1:$PORT/api"
export E2E_DATA_DIR="$E2E_DIR/data"
export E2E_SECRETS_DIR="$E2E_DIR/secrets"

# WebRTC env for server and start-webrtc.sh
export WEBRTC_PORT="$WEBRTC_PORT"
export WEBRTC_ENABLED="1"
export WEBRTC_SERVICE_URL="http://127.0.0.1:$WEBRTC_PORT"
export WEBRTC_PUBLIC_WS_URL="ws://127.0.0.1:$WEBRTC_PORT"
export RECORDING_CALLBACK_SECRET="e2e-secret"
# When E2E_SECRET_MISMATCH=1, webrtc uses a different secret to simulate recording/soundboard failures
if [ "${E2E_SECRET_MISMATCH:-}" = "1" ]; then
  export RECORDING_CALLBACK_SECRET_WEBRTC="mismatched-e2e-secret"
fi
# WEBRTC_SERVICE_SECRET left unset for e2e so webrtc HTTP endpoints work without auth (service is localhost-only)
export MAIN_APP_BASE_URL="http://127.0.0.1:$PORT"

# Avoid call_join IP ban from invalid-code tests; valid-code tests need by-code to succeed
export CALL_JOIN_FAILURE_THRESHOLD="${CALL_JOIN_FAILURE_THRESHOLD:-999}"

# Short timeouts for e2e (host-leave test) - must be long enough for host to connect and send first message (~5s)
export HOST_AWAY_GRACE_NO_GUESTS_MS="${HOST_AWAY_GRACE_NO_GUESTS_MS:-10000}"
export HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS="${HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS:-10000}"
export HOST_AWAY_GRACE_WITH_GUESTS_MS="${HOST_AWAY_GRACE_WITH_GUESTS_MS:-10000}"
export HOST_AWAY_CHECK_INTERVAL_MS="${HOST_AWAY_CHECK_INTERVAL_MS:-500}"
export FINALIZE_RTP_FLUSH_MS="${FINALIZE_RTP_FLUSH_MS:-200}"

# Clean and create data/secrets
rm -rf "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/webrtc-recordings" "$E2E_DIR/reports"
mkdir -p "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/webrtc-recordings" "$E2E_DIR/reports" "$E2E_DIR/assets"

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

# Server/webrtc output goes to e2e/server.log and e2e/webrtc.log only (no streaming)
# Ensure Playwright browsers are installed, then run tests
cd "$E2E_DIR"
pnpm exec playwright install chromium
EXIT_CODE=0
# WebRTC test runs headed (for reliable fake device). Use xvfb when no display (SSH, CI).
# E2E_WEBRTC_MODE: "fast" (default) = exclude @slow tests, "slow" = run only @slow, "full" = run all
PLAYWRIGHT_ARGS=""
case "${E2E_WEBRTC_MODE:-fast}" in
  slow)  PLAYWRIGHT_ARGS="--grep @slow" ;;
  full)  PLAYWRIGHT_ARGS="" ;;
  fast|*) PLAYWRIGHT_ARGS="--grep-invert @slow" ;;
esac
# Pass extra args to run a single test, e.g.:
#   pnpm run e2e:webrtc -- call-recording-core.spec.ts
#   pnpm run e2e:webrtc -- -g "records segment"
# Filter out server/webrtc log lines (in case of stray output)
run_playwright() {
  if [ -z "${DISPLAY:-}" ]; then
    if command -v xvfb-run &>/dev/null; then
      xvfb-run pnpm exec playwright test $PLAYWRIGHT_ARGS "$@"
    else
      echo "Error: Headed browser requires a display. Install xvfb and rerun, or run with DISPLAY set:" >&2
      echo "  apt install xvfb   # Debian/Ubuntu" >&2
      echo "  xvfb-run pnpm run e2e:webrtc" >&2
      exit 1
    fi
  else
    pnpm exec playwright test $PLAYWRIGHT_ARGS "$@"
  fi
}
run_playwright "$@" 2>&1 | grep --line-buffered -v -E '^\[(server|webrtc)\] '
EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -ne 0 ] && [ -f "$E2E_DIR/server.log" ]; then
  echo ""
  echo "=== Last 80 lines of server.log (look for [call] room/guest) ==="
  tail -80 "$E2E_DIR/server.log"
fi

# Stop webrtc and server
bash "$SCRIPT_DIR/stop-webrtc.sh"
bash "$SCRIPT_DIR/stop-server.sh"

exit $EXIT_CODE
