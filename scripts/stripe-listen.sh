#!/usr/bin/env bash
# Forward Stripe CLI events to a HarborFM webhook URL.
#
# Usage:
#   pnpm stripe:listen -- 'http://localhost:5173/api/public/stripe/webhook/<id>'
#
# Copy the webhook URL from Show > Payments. After listen starts, paste the
# printed whsec_… into that account's Test webhook secret in HarborFM.

set -euo pipefail

PORT="${STRIPE_FORWARD_PORT:-3001}"
WEBHOOK_URL=""

for arg in "$@"; do
  # pnpm/npm pass a literal "--" before script args; ignore it
  if [[ "$arg" == "--" ]]; then
    continue
  fi
  WEBHOOK_URL="$arg"
  break
done

if [[ -z "$WEBHOOK_URL" && -n "${STRIPE_WEBHOOK_URL:-}" ]]; then
  WEBHOOK_URL="$STRIPE_WEBHOOK_URL"
fi

if [[ -z "$WEBHOOK_URL" ]]; then
  echo "Missing webhook URL."
  echo ""
  echo "  pnpm stripe:listen -- 'http://localhost:5173/api/public/stripe/webhook/<id>'"
  echo ""
  echo "Copy the full webhook URL from Show > Payments."
  exit 1
fi

if [[ "$WEBHOOK_URL" != http://* && "$WEBHOOK_URL" != https://* ]]; then
  echo "Expected a full webhook URL (http:// or https://), got:"
  echo "  $WEBHOOK_URL"
  echo ""
  echo "  pnpm stripe:listen -- 'http://localhost:5173/api/public/stripe/webhook/<id>'"
  exit 1
fi

PATH_PART="$(printf '%s' "$WEBHOOK_URL" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+##')"
if [[ "$PATH_PART" != /api/public/stripe/webhook/* || "$PATH_PART" == */webhook/ || "$PATH_PART" == */webhook ]]; then
  echo "URL does not look like a HarborFM Stripe webhook:"
  echo "  $WEBHOOK_URL"
  echo "Expected …/api/public/stripe/webhook/<id>"
  exit 1
fi

# Always hit the API server directly (default :3001). Vite's host/port in the
# copied URL is fine for identifying the path; Stripe CLI should not depend on it.
FORWARD="127.0.0.1:${PORT}${PATH_PART}"

echo "Forwarding Stripe events to http://${FORWARD}"
echo "Paste the whsec_… below into this account's Test webhook secret in HarborFM."
echo ""
exec stripe listen --forward-to "$FORWARD"
