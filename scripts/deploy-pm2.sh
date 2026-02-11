#!/usr/bin/env bash
# Deploy HarborFM to PM2: build, then start the app (or reload if already running).
# Usage: from repo root, run: ./scripts/deploy-pm2.sh
# Requires: pnpm, pm2, Node >= 22

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

command -v pnpm >/dev/null || { echo "pnpm not found"; exit 1; }
command -v pm2  >/dev/null || { echo "pm2 not found"; exit 1; }
node -v

APP_NAME="${PM2_APP_NAME:-harborfm}"
ECOSYSTEM="${REPO_ROOT}/ecosystem.config.cjs"

echo "==> Installing dependencies (frozen)..."
pnpm install --frozen-lockfile

echo "==> Building..."
pnpm run build

echo "==> Ensuring logs dir..."
mkdir -p "$REPO_ROOT/logs"

if pm2 describe "$APP_NAME" &>/dev/null; then
  echo "==> Reloading existing PM2 app: $APP_NAME"
  pm2 reload "$ECOSYSTEM" --only "$APP_NAME" --update-env
else
  echo "==> Starting new PM2 app: $APP_NAME"
  pm2 start "$ECOSYSTEM" --only "$APP_NAME" --update-env
fi

echo "==> Saving PM2 process list..."
pm2 save

echo "==> Done. Status:"
pm2 describe "$APP_NAME" --no-color 2>/dev/null | head -20 || true
