#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEBRTC_PORT="${WEBRTC_PORT:-3098}"

if [ -f "$E2E_DIR/webrtc.pid" ]; then
  PID=$(cat "$E2E_DIR/webrtc.pid")
  if [ -n "$PID" ]; then
    # Kill process group so mediasoup worker child is also terminated
    kill -TERM -"$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
  fi
  rm -f "$E2E_DIR/webrtc.pid"
fi

lsof -t -i ":$WEBRTC_PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
pkill -f "webrtc-service/dist/index.js" 2>/dev/null || true
pkill -f "mediasoup-worker" 2>/dev/null || true
sleep 1
