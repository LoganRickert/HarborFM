#!/usr/bin/env bash
# Delete existing Cloudflare A records for a given FQDN.
# Used before Terraform creates the new record to avoid duplicate A records.
# Requires: curl, jq (or python3 for JSON parsing)
set -e

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN not set}"
: "${CLOUDFLARE_ZONE_ID:?CLOUDFLARE_ZONE_ID not set}"
: "${CLOUDFLARE_FQDN:?CLOUDFLARE_FQDN not set}"

RESP=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=A" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json")

if command -v jq >/dev/null 2>&1; then
  # Filter to exact FQDN match (API may return partial matches)
  IDs=$(echo "$RESP" | jq -r --arg fqdn "$CLOUDFLARE_FQDN" '.result[]? | select(.name == $fqdn) | .id')
else
  IDs=$(CLOUDFLARE_FQDN="$CLOUDFLARE_FQDN" python3 -c "
import json, os, sys
fqdn = os.environ.get('CLOUDFLARE_FQDN', '')
try:
    data = json.load(sys.stdin)
    for r in data.get('result', []):
        if r.get('name') == fqdn:
            print(r.get('id', ''))
except: pass
" 2>/dev/null <<< "$RESP" || true)
fi

for id in $IDs; do
  if [ -n "$id" ]; then
    curl -s -X DELETE \
      "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${id}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" >/dev/null || true
  fi
done
