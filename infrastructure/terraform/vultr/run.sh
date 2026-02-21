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

# When destroying: detach block storage first (so instance can be destroyed), then destroy everything except block storage.
# Block storage stays in state; next apply recreates instance and reattaches the same volume (data preserved).
if [ "$1" = "destroy" ]; then
  if terraform state list 2>/dev/null | grep -q 'vultr_block_storage\.data'; then
    echo "Detaching block storage from instance..."
    terraform apply -var="attach_data_volume=false" -target='vultr_block_storage.data[0]' -auto-approve || true
  fi
  TARGETS=$(terraform state list 2>/dev/null | grep -v 'vultr_block_storage\.data' | sed 's/^/-target=/' | tr '\n' ' ')
  if [ -n "$TARGETS" ]; then
    exec terraform destroy "${@:2}" $TARGETS
  fi
  echo "Only block storage remains in state (detached). Nothing else to destroy."
  exit 0
fi

exec terraform "$@"
