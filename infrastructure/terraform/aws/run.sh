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

# FlareVault: when set, create package before apply and PATCH allowedCidr after apply.
REDEEM_TOKEN_SAVED=""
maybe_create_flarevault_package() {
  [ "$1" != "apply" ] && return 0
  [ -z "${FLAREVAULT_URL:-}" ] || [ -z "${FLAREVAULT_ADMIN_TOKEN:-}" ] && return 0
  local email="${TF_VAR_admin_email:-}"
  local pass="${TF_VAR_admin_password:-}"
  [ -z "$email" ] && [ -n "${admin_email:-}" ] && email="$admin_email"
  [ -z "$pass" ] && [ -n "${admin_password:-}" ] && pass="$admin_password"
  [ -z "$email" ] || [ -z "$pass" ] && return 0
  local workspace
  workspace=$(terraform workspace show 2>/dev/null) || workspace="default"
  local instance_id="aws:${workspace}"
  local hash
  hash=$(cd "$(dirname "$0")/../../../server" && echo "$(jq -n --arg p "$pass" '{password:$p}')" | node scripts/hash-admin-password.mjs 2>/dev/null | jq -r .hash) || return 0
  [ -z "$hash" ] || [ "$hash" = "null" ] && return 0
  local initial_token
  initial_token=$(openssl rand -hex 32 2>/dev/null | sed 's/^/hfm_/' 2>/dev/null) || initial_token=""
  local payload
  payload=$(jq -n --arg e "$email" --arg h "$hash" --arg t "$initial_token" '{admin_email:$e, admin_password_hash:$h} + (if $t != "" then {initial_admin_api_token:$t} else {} end)')
  local res
  res=$(curl -s -S -X POST "${FLAREVAULT_URL}/v1/packages" \
    -H "Authorization: Bearer $FLAREVAULT_ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"instanceId\":\"$instance_id\",\"payload\":$payload,\"expiresInSeconds\":1800}") || return 0
  REDEEM_TOKEN_SAVED=$(echo "$res" | jq -r .redeemToken)
  [ -z "$REDEEM_TOKEN_SAVED" ] || [ "$REDEEM_TOKEN_SAVED" = "null" ] && return 0
  export TF_VAR_flarevault_url="$FLAREVAULT_URL"
  export TF_VAR_flarevault_redeem_token="$REDEEM_TOKEN_SAVED"
  unset TF_VAR_admin_email TF_VAR_admin_password
  echo "[run.sh] FlareVault package created; redeem token passed to Terraform (admin creds omitted from user-data)."
  return 0
}
maybe_patch_flarevault_cidr() {
  [ -z "$REDEEM_TOKEN_SAVED" ] && return 0
  local ip
  ip=$(terraform output -raw public_ip 2>/dev/null) || true
  [ -z "$ip" ] && return 0
  local cidr="${ip}/32"
  curl -s -S -X PATCH "${FLAREVAULT_URL}/v1/packages" \
    -H "Authorization: Bearer $FLAREVAULT_ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"redeemToken\":\"$REDEEM_TOKEN_SAVED\",\"allowedCidr\":\"$cidr\"}" >/dev/null && echo "[run.sh] FlareVault package PATCHed with allowedCidr=$cidr." || true
}

# FlareVault: before apply, create package and pass redeem token into Terraform
maybe_create_flarevault_package "$1" || true

if [ "$1" = "apply" ]; then
  terraform "$@"
  APPLY_EXIT=$?
  if [ $APPLY_EXIT -eq 0 ] && [ -n "$REDEEM_TOKEN_SAVED" ]; then
    maybe_patch_flarevault_cidr || true
  fi
  exit $APPLY_EXIT
fi

exec terraform "$@"
