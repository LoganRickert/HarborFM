#!/usr/bin/env bash
# HarborFM - one-line install (no clone required)
# Usage: curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | bash
#    or: curl -fsSL ... | bash -s -- /path/to/install-dir
#    or: curl -fsSL ... | bash -s -- --no-interaction /path/to/install-dir
# Non-interaction: use --no-interaction, -y, -n, or env CI=1 / NON_INTERACTIVE=1
set -e

# Non-interaction: skip all prompts, use defaults
NON_INTERACTIVE=false
for arg in "$@"; do
  case "$arg" in
    --no-interaction|-y|-n) NON_INTERACTIVE=true; break ;;
  esac
done
[ "${CI:-0}" = "1" ] || [ "${NON_INTERACTIVE:-0}" = "1" ] && NON_INTERACTIVE=true

# Where to fetch configs from (override with env if you mirror the repo)
HARBORFM_REPO="${HARBORFM_REPO:-loganrickert/harborfm}"
HARBORFM_BRANCH="${HARBORFM_BRANCH:-main}"
BASE_URL="https://raw.githubusercontent.com/${HARBORFM_REPO}/${HARBORFM_BRANCH}"

# Install directory: first non-flag argument or default
INSTALL_DIR=""
for arg in "$@"; do
  case "$arg" in
    --no-interaction|-y|-n) ;;
    *) INSTALL_DIR="${arg:-./harborfm-docker}"; break ;;
  esac
done
INSTALL_DIR="${INSTALL_DIR:-./harborfm-docker}"
INSTALL_DIR="$(cd -P "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"

echo "=== HarborFM Docker install ==="
echo "Install directory: $INSTALL_DIR"
echo ""

# Docker checks
if ! command -v docker &>/dev/null; then
  echo "Error: docker is not installed or not in PATH." >&2
  exit 1
fi
if ! docker compose version &>/dev/null; then
  echo "Error: docker compose is not available. Need Docker Compose v2." >&2
  exit 1
fi

# curl or wget for downloads
download() {
  local url="$1"
  local dest="$2"
  local dir
  dir="$(dirname "$dest")"
  mkdir -p "$dir"
  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget &>/dev/null; then
    wget -q -O "$dest" "$url"
  else
    echo "Error: need curl or wget to download files." >&2
    exit 1
  fi
}

echo "Downloading configs from GitHub..."
download "$BASE_URL/docker-compose.yml"        "$INSTALL_DIR/docker-compose.yml"
download "$BASE_URL/nginx/entrypoint.sh"       "$INSTALL_DIR/nginx/entrypoint.sh"
download "$BASE_URL/nginx/nginx-80-only.conf.template"  "$INSTALL_DIR/nginx/nginx-80-only.conf.template"
download "$BASE_URL/nginx/nginx-full.conf.template"   "$INSTALL_DIR/nginx/nginx-full.conf.template"
download "$BASE_URL/caddy/Caddyfile"           "$INSTALL_DIR/caddy/Caddyfile"
download "$BASE_URL/caddy/Caddyfile.webrtc"    "$INSTALL_DIR/caddy/Caddyfile.webrtc"
download "$BASE_URL/fail2ban/filter.d/nginx-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/nginx-scanner.conf"
download "$BASE_URL/fail2ban/jail.d/nginx-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/nginx-scanner.local"
download "$BASE_URL/fail2ban/filter.d/caddy-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/caddy-scanner.conf"
download "$BASE_URL/fail2ban/jail.d/caddy-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/caddy-scanner.local"
download "$BASE_URL/update.sh" "$INSTALL_DIR/update.sh"
download "$BASE_URL/nginx-add-domain.sh" "$INSTALL_DIR/nginx-add-domain.sh"
chmod +x "$INSTALL_DIR/nginx/entrypoint.sh"
chmod +x "$INSTALL_DIR/update.sh"
chmod +x "$INSTALL_DIR/nginx-add-domain.sh"
echo "Configs downloaded."
echo ""

cd "$INSTALL_DIR"

# .env (read from /dev/tty so prompts work when script is piped: curl ... | bash)
if [ -f .env ]; then
  echo "Existing .env found."
  if [ "$NON_INTERACTIVE" = true ]; then
    overwrite="n"
  else
    read -r -p "Overwrite with new values? [y/N] " overwrite </dev/tty
  fi
  if [[ ! "$overwrite" =~ ^[yY] ]]; then
    echo "Using existing .env. Skipping prompts."
    set -a
    # shellcheck source=/dev/null
    source .env
    set +a
    DOMAIN="${DOMAIN:-localhost}"
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
    SELF_SIGNED_CERT="${SELF_SIGNED_CERT:-0}"
    TZ="${TZ:-}"
    REVERSE_PROXY="${REVERSE_PROXY:-nginx}"
  else
    overwrite_env=true
  fi
else
  overwrite_env=true
fi

if [ "${overwrite_env:-false}" = true ]; then
  echo ""
  if [ "$NON_INTERACTIVE" = true ]; then
    DOMAIN="${DOMAIN:-localhost}"
    REVERSE_PROXY="${REVERSE_PROXY:-nginx}"
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
    SELF_SIGNED_CERT="${SELF_SIGNED_CERT:-0}"
    COOKIE_SECURE=""
    if [ "$DOMAIN" = "localhost" ] || { [ "$REVERSE_PROXY" = "nginx" ] && [ -z "$CERTBOT_EMAIL" ] && [ "${SELF_SIGNED_CERT:-0}" != "1" ]; }; then
      COOKIE_SECURE="false"
    fi
    WEBRTC_CHOICE="y"
  else
    read -r -p "Domain name (e.g. harborfm.example.com) [localhost]: " DOMAIN </dev/tty
    DOMAIN="${DOMAIN:-localhost}"

    echo "Reverse proxy: nginx = single domain, certbot for SSL; Caddy = automatic HTTPS, better for multiple/dynamic hostnames."
    read -r -p "Use nginx or Caddy? [nginx]: " REVERSE_PROXY </dev/tty
    REVERSE_PROXY="${REVERSE_PROXY:-nginx}"
    if [[ ! "$REVERSE_PROXY" =~ ^[cC]addy ]]; then
      REVERSE_PROXY=nginx
    else
      REVERSE_PROXY=caddy
    fi

    read -r -p "Email for Let's Encrypt (required for real SSL with nginx, empty to skip certbot): " CERTBOT_EMAIL </dev/tty
    CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

    # Self-signed cert: when not using Let's Encrypt and domain is not localhost
    SELF_SIGNED_CERT=0
    if [ "$REVERSE_PROXY" = "nginx" ] && [ -z "$CERTBOT_EMAIL" ] && [ "$DOMAIN" != "localhost" ]; then
      read -r -p "Use self-signed certificate for HTTPS? (browsers will show a warning) [y/N] " SELF_SIGNED_CHOICE </dev/tty
      if [[ "$SELF_SIGNED_CHOICE" =~ ^[yY] ]]; then
        SELF_SIGNED_CERT=1
      fi
    fi

    # Insecure cookies: only relevant when using HTTP (localhost or nginx without cert/self-signed)
    COOKIE_SECURE=""
    if [ "$DOMAIN" = "localhost" ] || { [ "$REVERSE_PROXY" = "nginx" ] && [ -z "$CERTBOT_EMAIL" ] && [ "${SELF_SIGNED_CERT:-0}" != "1" ]; }; then
      read -r -p "Allow insecure cookies? Required for login over HTTP-only. [y/N] " INSECURE_COOKIES </dev/tty
      if [[ "$INSECURE_COOKIES" =~ ^[yY] ]]; then
        COOKIE_SECURE="false"
      fi
    fi

    read -r -p "Enable WebRTC (group calls, remote recording)? [Y/n] " WEBRTC_CHOICE </dev/tty
  fi
  if [[ ! "$WEBRTC_CHOICE" =~ ^[nN] ]]; then
    WEBRTC_ENABLED=1
    WEBRTC_SERVICE_SECRET="$(openssl rand -base64 32)"
    RECORDING_CALLBACK_SECRET="$(openssl rand -base64 32)"
    if [ "$DOMAIN" = "localhost" ] || { [ "$REVERSE_PROXY" = "nginx" ] && [ -z "$CERTBOT_EMAIL" ] && [ "${SELF_SIGNED_CERT:-0}" != "1" ]; }; then
      WEBRTC_PUBLIC_WS_URL="ws://${DOMAIN}/webrtc-ws"
    else
      WEBRTC_PUBLIC_WS_URL="wss://${DOMAIN}/webrtc-ws"
    fi
  else
    WEBRTC_ENABLED=0
  fi

  if [ "$NON_INTERACTIVE" = true ]; then
    TZ="${TZ:-}"
  else
    read -r -p "Optional timezone for fail2ban (e.g. America/New_York, Enter to skip): " TZ </dev/tty
    TZ="${TZ:-}"
  fi

  if [ "$REVERSE_PROXY" = "caddy" ] && [ -z "${CADDY_TLS_CHECK_SECRET:-}" ]; then
    CADDY_TLS_CHECK_SECRET="$(openssl rand -hex 32)"
  fi
  {
    echo "# Generated by install.sh"
    echo "INSTALL_DIR=$INSTALL_DIR"
    echo "DOMAIN=$DOMAIN"
    echo "REVERSE_PROXY=$REVERSE_PROXY"
    echo "CERTBOT_EMAIL=$CERTBOT_EMAIL"
    [ "${SELF_SIGNED_CERT:-0}" = "1" ] && echo "SELF_SIGNED_CERT=1"
    [ -n "$COOKIE_SECURE" ] && echo "COOKIE_SECURE=$COOKIE_SECURE"
    [ "$REVERSE_PROXY" = "caddy" ] && [ -n "${CADDY_TLS_CHECK_SECRET:-}" ] && echo "CADDY_TLS_CHECK_SECRET=$CADDY_TLS_CHECK_SECRET"
    echo "WEBRTC_ENABLED=${WEBRTC_ENABLED:-0}"
    if [ "${WEBRTC_ENABLED:-0}" = "1" ]; then
      echo "WEBRTC_SERVICE_URL=http://webrtc:3002"
      echo "WEBRTC_PUBLIC_WS_URL=$WEBRTC_PUBLIC_WS_URL"
      echo "WEBRTC_SERVICE_SECRET=$WEBRTC_SERVICE_SECRET"
      echo "RECORDING_CALLBACK_SECRET=$RECORDING_CALLBACK_SECRET"
    fi
    [ -n "$TZ" ] && echo "TZ=$TZ"
  } > .env
  echo "Wrote .env"
  echo ""
fi

# Default REVERSE_PROXY for existing .env without it
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi
REVERSE_PROXY="${REVERSE_PROXY:-nginx}"

# Ensure .env has INSTALL_DIR and REVERSE_PROXY (avoids wrong path when reusing old volumes; backward compat for proxy choice)
if ! grep -q '^INSTALL_DIR=' .env 2>/dev/null; then
  echo "INSTALL_DIR=$INSTALL_DIR" >> .env
fi
if ! grep -q '^REVERSE_PROXY=' .env 2>/dev/null; then
  echo "REVERSE_PROXY=${REVERSE_PROXY:-nginx}" >> .env
fi
if [ "$REVERSE_PROXY" = "caddy" ] && ! grep -q '^CADDY_TLS_CHECK_SECRET=' .env 2>/dev/null; then
  echo "CADDY_TLS_CHECK_SECRET=$(openssl rand -hex 32)" >> .env
  echo "Added CADDY_TLS_CHECK_SECRET to .env for Caddy on-demand TLS."
fi
# Export so docker compose sees it when run from this script
export INSTALL_DIR

echo "Ensuring harborfm-data directories exist (shared layout with PM2 for data/secrets/webrtc)..."
mkdir -p \
  "$INSTALL_DIR/harborfm-data/data" \
  "$INSTALL_DIR/harborfm-data/secrets" \
  "$INSTALL_DIR/harborfm-data/webrtc" \
  "$INSTALL_DIR/harborfm-data/proxy/certbot/webroot" \
  "$INSTALL_DIR/harborfm-data/proxy/certbot/certs" \
  "$INSTALL_DIR/harborfm-data/proxy/nginx/logs" \
  "$INSTALL_DIR/harborfm-data/proxy/nginx/sites-enabled" \
  "$INSTALL_DIR/harborfm-data/proxy/caddy/data" \
  "$INSTALL_DIR/harborfm-data/proxy/caddy/config" \
  "$INSTALL_DIR/harborfm-data/proxy/caddy/logs" \
  "$INSTALL_DIR/harborfm-data/whisper/cache"

# Placeholder so nginx include sites-enabled/*.conf does not fail when no extra sites exist
placeholder="$INSTALL_DIR/harborfm-data/proxy/nginx/sites-enabled/00-placeholder.conf"
if [ ! -f "$placeholder" ]; then
  echo '# Additional sites; add .conf files here (e.g. via nginx-add-domain.sh).' > "$placeholder"
fi

# Fail2ban caddy-scanner jail requires this file; create so fail2ban starts when only nginx is used
touch "$INSTALL_DIR/harborfm-data/proxy/caddy/logs/access.log" 2>/dev/null || true
touch "$INSTALL_DIR/harborfm-data/proxy/nginx/logs/access.log" 2>/dev/null || true

# Caddy: use WebRTC-enabled Caddyfile when webrtc profile is used
if [ "$REVERSE_PROXY" = "caddy" ] && [ "${WEBRTC_ENABLED:-0}" = "1" ]; then
  cp "$INSTALL_DIR/caddy/Caddyfile.webrtc" "$INSTALL_DIR/caddy/Caddyfile"
fi

COMPOSE_PROFILES="$REVERSE_PROXY"
[ "${WEBRTC_ENABLED:-0}" = "1" ] && COMPOSE_PROFILES="$COMPOSE_PROFILES webrtc"
echo "Starting containers (compose up with profile: $COMPOSE_PROFILES)..."
set +e
compose_out=$(docker compose --profile "$REVERSE_PROXY" $([ "${WEBRTC_ENABLED:-0}" = "1" ] && echo "--profile webrtc") up -d 2>&1)
compose_rc=$?
set -e
echo "$compose_out"
if [ "$compose_rc" -ne 0 ]; then
  if echo "$compose_out" | grep -q "no such file or directory"; then
    echo ""
    echo "One or more volume paths are missing (e.g. after moving the install directory)."
    echo "Recreate volumes with: docker compose down -v && docker compose --profile $REVERSE_PROXY up -d"
    echo "Warning: -v removes volume data (app data, certs, whisper cache). Back up harborfm-data first if needed."
  fi
  exit 1
fi

echo ""
echo "Waiting for reverse proxy to be ready..."
for i in {1..30}; do
  if [ "$REVERSE_PROXY" = "caddy" ]; then
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1/caddy-health" 2>/dev/null | grep -q '200'; then
      echo "Caddy is up."
      break
    fi
  else
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1/.well-known/acme-challenge/" 2>/dev/null | grep -q '404\|403'; then
      echo "Nginx is up."
      break
    fi
  fi
  if [ "$i" -eq 30 ]; then
    echo "Warning: reverse proxy may not be ready yet. If using nginx, certbot might fail; you can run it again later."
  fi
  sleep 1
done

if [ "$REVERSE_PROXY" = "nginx" ] && [ "${SELF_SIGNED_CERT:-0}" = "1" ] && [ "$DOMAIN" != "localhost" ]; then
  echo ""
  echo "Generating self-signed certificate for $DOMAIN..."
  if docker compose run --rm --entrypoint /bin/sh nginx -c "
    mkdir -p /etc/letsencrypt/live/${DOMAIN}
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout /etc/letsencrypt/live/${DOMAIN}/privkey.pem \
      -out /etc/letsencrypt/live/${DOMAIN}/fullchain.pem \
      -subj \"/CN=${DOMAIN}\"
  " 2>/dev/null; then
    echo "Self-signed certificate created. Nginx will reload within ~60 seconds to use it."
    echo "Browsers will show a security warning; accept it for this domain or add an exception."
  else
    echo "Failed to generate self-signed certificate. Check docker compose logs."
  fi
elif [ "$REVERSE_PROXY" = "nginx" ] && [ -n "$CERTBOT_EMAIL" ] && [ "$DOMAIN" != "localhost" ]; then
  echo ""
  if [ "$NON_INTERACTIVE" = true ]; then
    run_certbot="n"
  else
    read -r -p "Obtain Let's Encrypt certificate for $DOMAIN now? [Y/n] " run_certbot </dev/tty
  fi
  if [[ ! "$run_certbot" =~ ^[nN] ]]; then
    echo "Running certbot..."
    if docker compose run --rm certbot; then
      echo "Certificate obtained. Nginx will reload within ~60 seconds to use it."
    else
      echo "Certbot failed or skipped (e.g. rate limit, DNS not pointed). Run later: docker compose run --rm certbot"
    fi
  else
    echo "Skipped. Run when ready: docker compose run --rm certbot"
  fi
elif [ "$REVERSE_PROXY" = "nginx" ]; then
  echo ""
  if [ "$DOMAIN" = "localhost" ]; then
    echo "Domain is localhost - using HTTP only."
  elif [ -z "$CERTBOT_EMAIL" ] && [ "${SELF_SIGNED_CERT:-0}" != "1" ]; then
    echo "Email not set and self-signed not chosen - using HTTP only."
    echo "Edit .env (CERTBOT_EMAIL for Let's Encrypt, or SELF_SIGNED_CERT=1), then run certbot or regenerate."
  fi
fi

echo ""
echo "=== Done ==="
SETUP_PATH="$(cd "$INSTALL_DIR" && docker compose logs harborfm 2>&1 | grep -oE '/setup\?id=[A-Za-z0-9_.-]+' | head -1)"
if [ -n "$SETUP_PATH" ]; then
  echo "  Setup:   https://${DOMAIN}${SETUP_PATH} (or http:// if no cert yet)"
fi
echo "  App:     https://${DOMAIN}/ (or http:// if no cert yet)"
if [ "$REVERSE_PROXY" = "nginx" ]; then
  if [ "${SELF_SIGNED_CERT:-0}" = "1" ]; then
    echo "  SSL:     Self-signed cert (1 year). Regenerate manually when expired."
  elif [ -n "$CERTBOT_EMAIL" ]; then
    echo "  Renew:   docker compose run --rm certbot renew"
  fi
else
  echo "  SSL:     Caddy auto-renews certificates (no certbot)."
fi
echo "  Update:  ./update.sh   (from $INSTALL_DIR)"
echo "  Logs:    docker compose logs -f"
echo "  Stop:    docker compose down"
echo "  Install: $INSTALL_DIR"
