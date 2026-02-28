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
  local instance_id="vultr:${workspace}"
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

# When destroying (or plan -destroy): exclude block storage from scope.
# Block storage has lifecycle.prevent_destroy and is no longer referenced by the instance
# (attach/detach is done via null_resource + Vultr API), so targeted destroy never touches it.
get_destroy_targets() {
  terraform state list 2>/dev/null | grep -v 'vultr_block_storage' | sed 's/^/-target=/' | tr '\n' ' '
}
get_destroy_targets_without_instance() {
  terraform state list 2>/dev/null | grep -v 'vultr_block_storage' | grep -v 'vultr_instance.harborfm' | sed 's/^/-target=/' | tr '\n' ' '
}

if [ "$1" = "destroy" ]; then
  export TF_VAR_attach_data_volume=false
  DESTROY_VARS="-var=attach_data_volume=false"
  # Phase 1: destroy instance. null_resource.block_attach runs its destroy provisioner first (detach via API).
  # Block storage has no config reference to instance, so it is not in the plan.
  if terraform state list 2>/dev/null | grep -q 'vultr_instance.harborfm'; then
    echo "Phase 1: destroying instance (block will be detached by Terraform first)..."
    terraform destroy -auto-approve $DESTROY_VARS "${@:2}" -target=vultr_instance.harborfm
  fi
  # When destroying storage: delete block via Vultr API and remove from state (bypasses lifecycle.prevent_destroy).
  # Do this before Phase 2 so block storage is no longer in state and cannot appear in the Phase 2 plan.
  if [ -n "${DESTROY_STORAGE:-}" ]; then
    echo "Phase 2a: destroying block storage (via API + state rm)..."
    for addr in $(terraform state list 2>/dev/null | grep 'vultr_block_storage' || true); do
      [ -z "$addr" ] && continue
      block_id=$(terraform state show -no-color "$addr" 2>/dev/null | sed -n 's/^[[:space:]]*id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
      if [ -n "$block_id" ] && [ -n "${VULTR_API_KEY:-}" ]; then
        curl -sf -X DELETE "https://api.vultr.com/v2/blocks/$block_id" -H "Authorization: Bearer $VULTR_API_KEY" || true
        terraform state rm "$addr"
      fi
    done
  fi
  TARGETS_NO_INSTANCE=$(get_destroy_targets_without_instance)
  if [ -n "$TARGETS_NO_INSTANCE" ]; then
    echo "Phase 2: destroying dependents (DNS, firewall, delay resource)..."
    terraform destroy -auto-approve $DESTROY_VARS "${@:2}" $TARGETS_NO_INSTANCE
  fi
  if [ -n "${DESTROY_STORAGE:-}" ]; then
    echo "Destroy + storage complete."
  else
    echo "Only block storage remains in state (detached). Nothing else to destroy."
  fi
  exit 0
fi

# plan -destroy: exclude block storage so we never see "will be destroyed" for it
if [ "$1" = "plan" ] && [[ " ${*:2} " =~ " -destroy " ]]; then
  export TF_VAR_attach_data_volume=false
  TARGETS=$(get_destroy_targets)
  if [ -n "$TARGETS" ]; then
    exec terraform plan "${@:2}" $TARGETS
  fi
fi

# FlareVault: before apply, create package and pass redeem token into Terraform
maybe_create_flarevault_package "$1" || true

# When instance-manager runs apply, hide tfvars so only -var values from the server are used.
hide_tfvars_for_instance_manager() {
  [ -z "${INSTANCE_MANAGER:-}" ] || [ "$1" != "apply" ] && return 0
  for f in terraform.tfvars terraform.tfvars.json *.auto.tfvars *.auto.tfvars.json; do
    [ -f "$f" ] || continue
    mv "$f" "$f.bak" && echo "[run.sh] Hid $f (INSTANCE_MANAGER=1: use server values only)."
  done
}
restore_tfvars_for_instance_manager() {
  for f in terraform.tfvars.bak terraform.tfvars.json.bak *.auto.tfvars.bak *.auto.tfvars.json.bak; do
    [ -f "$f" ] || continue
    mv "$f" "${f%.bak}" && echo "[run.sh] Restored ${f%.bak}."
  done
}

if [ "$1" = "apply" ]; then
  hide_tfvars_for_instance_manager "$1" || true
  trap restore_tfvars_for_instance_manager EXIT
  terraform "$@"
  APPLY_EXIT=$?
  restore_tfvars_for_instance_manager
  trap - EXIT
  if [ $APPLY_EXIT -eq 0 ] && [ -n "$REDEEM_TOKEN_SAVED" ]; then
    maybe_patch_flarevault_cidr || true
  fi
  exit $APPLY_EXIT
fi

exec terraform "$@"
