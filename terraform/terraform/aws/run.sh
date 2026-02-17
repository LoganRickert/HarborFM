#!/usr/bin/env bash
# Load .env (if present) and run Terraform. Use: ./run.sh apply, ./run.sh plan, etc.
# Terraform reads variables from TF_VAR_<name>; we map common .env names so e.g. CLOUDFLARE_API_TOKEN works.
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && export TF_VAR_cloudflare_api_token="$CLOUDFLARE_API_TOKEN"
exec terraform "$@"
