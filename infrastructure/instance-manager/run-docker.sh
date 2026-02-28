#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ENV_FILE=".env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE (copy from .env.example and fill in)." >&2
  exit 1
fi
if ! grep -q '^MANAGER_SECRET=.' "$ENV_FILE" 2>/dev/null; then
  MANAGER_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
  echo "MANAGER_SECRET=$MANAGER_SECRET" >> "$ENV_FILE"
  echo "Added MANAGER_SECRET to $ENV_FILE" >&2
fi
mkdir -p tfstate
[[ -f config.json ]] || echo '{}' > config.json
[[ -f data.json ]] || echo '{}' > data.json
docker run --rm -it --init \
  --env-file "$ENV_FILE" \
  -p 3997:3999 \
  -v "$SCRIPT_DIR/tfstate:/data" \
  -v "$SCRIPT_DIR/config.json:/app/manager/config.json" \
  -v "$SCRIPT_DIR/data.json:/app/manager/data.json" \
  instance-manager
