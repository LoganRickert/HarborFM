#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
WEBRTC_PORT="${WEBRTC_PORT:-3098}"
export WEBRTC_PORT
export RECORDING_DATA_DIR="${E2E_DIR}/webrtc-recordings"
export MAIN_APP_URL="${MAIN_APP_BASE_URL:-http://127.0.0.1:${E2E_PORT:-3099}}"
export PORT="$WEBRTC_PORT"
export RECORDING_CALLBACK_SECRET="${RECORDING_CALLBACK_SECRET:-e2e-secret}"
# Wider UDP port range to avoid "no more available ports" (default 40000-40100 exhausted)
# Use 41000-41200 (recording uses 50000+)
export RTC_MIN_PORT="${RTC_MIN_PORT:-41000}"
export RTC_MAX_PORT="${RTC_MAX_PORT:-41200}"

# Stop any existing webrtc process so we start fresh with the new build
bash "$SCRIPT_DIR/stop-webrtc.sh" 2>/dev/null || true

cd "$ROOT"

echo "" > "$E2E_DIR/webrtc.log"
pnpm --filter webrtc-service build

node webrtc-service/dist/index.js 1>>"$E2E_DIR/webrtc.log" 2>&1 &
echo $! > "$E2E_DIR/webrtc.pid"

# Wait for webrtc HTTP server to be ready (GET /health does not spawn mediasoup)
for i in {1..30}; do
  echo "Waiting for WebRTC service to be ready..."
  if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$WEBRTC_PORT/health" 2>/dev/null | grep -q 200; then
    exit 0
  fi
  sleep 0.5
done
echo "WebRTC service did not become ready in time" >&2
exit 1
