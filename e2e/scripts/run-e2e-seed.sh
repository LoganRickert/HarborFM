#!/usr/bin/env bash
# E2E tests for password seed: admin is created via db:seedSetup (ADMIN_EMAIL + ADMIN_PASSWORD)
# instead of /setup/complete. Uses a fresh data dir, runs seed, then starts server and runs Seed suite.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="$(cd "$E2E_DIR/.." && pwd)"
PORT="${E2E_PORT:-3099}"
export E2E_PORT="$PORT"
export E2E_BASE_URL="http://127.0.0.1:$PORT/api"
export E2E_DATA_DIR="$E2E_DIR/data"
export E2E_SECRETS_DIR="$E2E_DIR/secrets"

# Seed credentials (must match values used in e2e/tests/Seed/seed.js)
export SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-seed-admin@e2e.test}"
export SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-seed-password-123}"

# Clean and create data/secrets (no setup token - seed creates admin without it)
rm -rf "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"
mkdir -p "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"

# Run migrations + seed with ADMIN_* env so the DB gets the admin before server start
export DATA_DIR="$E2E_DIR/data"
export SECRETS_DIR="$E2E_DIR/secrets"
export ADMIN_EMAIL="$SEED_ADMIN_EMAIL"
export ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD"
cd "$ROOT/server"
pnpm run db:seedSetup
cd "$ROOT"

# Start server (uses same DATA_DIR; admin already exists)
bash "$E2E_DIR/scripts/start-server.sh"

# Run only the Seed suite
cd "$E2E_DIR"
EXIT_CODE=0
E2E_SUITE=Seed node run.js || EXIT_CODE=$?

# Stop server
bash "$E2E_DIR/scripts/stop-server.sh"

exit $EXIT_CODE
