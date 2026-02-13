#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${E2E_PORT:-3099}"
export E2E_PORT="$PORT"
export E2E_BASE_URL="http://127.0.0.1:$PORT/api"
export E2E_DATA_DIR="$E2E_DIR/data"
export E2E_SECRETS_DIR="$E2E_DIR/secrets"

# Clean and create data/secrets
rm -rf "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"
mkdir -p "$E2E_DIR/data" "$E2E_DIR/secrets" "$E2E_DIR/reports"

# Pre-create setup token so we can complete setup (server reads from data/setup-token.txt)
echo "e2e-setup-token-$(openssl rand -hex 16)" > "$E2E_DIR/data/setup-token.txt"

# Start server
bash "$SCRIPT_DIR/start-server.sh"

# Run tests (from e2e dir so run.js finds tests and lib)
cd "$E2E_DIR"
EXIT_CODE=0
node run.js || EXIT_CODE=$?

# Stop server
bash "$SCRIPT_DIR/stop-server.sh"

exit $EXIT_CODE
