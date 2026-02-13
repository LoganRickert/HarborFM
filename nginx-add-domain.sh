#!/usr/bin/env bash
# Harbor FM - add an additional nginx site and obtain Let's Encrypt cert (nginx only)
# Usage: ./nginx-add-domain.sh <domain> [install-dir]
# Run from install directory or pass install-dir (where docker-compose.yml and .env live).
# Requires REVERSE_PROXY=nginx and CERTBOT_EMAIL in .env. DNS for the domain must already point to this host.
set -e

# Domain to add (first arg); keep in ADD_DOMAIN so .env cannot overwrite it
ADD_DOMAIN="${1:-}"
INSTALL_DIR="${2:-$(cd -P "$(dirname "$0")" && pwd)}"
INSTALL_DIR="$(cd -P "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"

if [ -z "$ADD_DOMAIN" ]; then
  echo "Usage: $0 <domain> [install-dir]" >&2
  echo "Example: $0 mydomain.harborfm.com" >&2
  exit 1
fi

if [[ "$ADD_DOMAIN" == */* ]] || [[ "$ADD_DOMAIN" != *.* ]]; then
  echo "Error: domain must contain a dot and no slashes (e.g. mydomain.harborfm.com)." >&2
  exit 1
fi

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  echo "Error: docker-compose.yml not found in $INSTALL_DIR. Run install.sh first or pass the install path." >&2
  exit 1
fi

if [ -f "$INSTALL_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$INSTALL_DIR/.env"
  set +a
fi

# Re-export for docker compose (INSTALL_DIR may have been set by .env)
export INSTALL_DIR

missing=""
if [ -z "${REVERSE_PROXY:-}" ]; then
  missing="REVERSE_PROXY=nginx"
fi
if [ -z "${CERTBOT_EMAIL:-}" ]; then
  [ -n "$missing" ] && missing="$missing, "
  missing="${missing}CERTBOT_EMAIL=your@email.com"
fi
if [ -n "$missing" ]; then
  echo "Error: the following are not set in .env. Add them to your .env file: $missing" >&2
  exit 1
fi
if [ "$REVERSE_PROXY" != "nginx" ]; then
  echo "Error: this script is for nginx only. REVERSE_PROXY is set to '$REVERSE_PROXY'." >&2
  exit 1
fi

# Primary domain is already in the main nginx config; adding it here would cause "conflicting server name" warnings
if [ -n "${DOMAIN:-}" ] && [ "$ADD_DOMAIN" = "$DOMAIN" ]; then
  echo "Error: $ADD_DOMAIN is your primary domain (DOMAIN in .env). It is already served by the main nginx config. Use sites-enabled only for additional domains." >&2
  exit 1
fi

SITES_ENABLED="$INSTALL_DIR/harborfm-docker-data/nginx/sites-enabled"
mkdir -p "$SITES_ENABLED"

echo "Using sites-enabled: $SITES_ENABLED"

# Check we can write (e.g. avoid silent failure when directory is root-owned)
if ! { [ -w "$SITES_ENABLED" ] && touch "$SITES_ENABLED/.write-test" 2>/dev/null; }; then
  echo "Error: cannot write to $SITES_ENABLED (permission denied). Fix ownership, e.g.: sudo chown -R \$USER:\$USER $SITES_ENABLED" >&2
  exit 1
fi
rm -f "$SITES_ENABLED/.write-test"

# Ensure at least one .conf exists so nginx include does not error
if [ ! -f "$SITES_ENABLED/00-placeholder.conf" ]; then
  if ! echo '# Additional sites; add .conf files here (e.g. via nginx-add-domain.sh).' > "$SITES_ENABLED/00-placeholder.conf" 2>/dev/null; then
    echo "Error: cannot write to $SITES_ENABLED/00-placeholder.conf (permission denied). Fix ownership, e.g.: sudo chown -R \$USER:\$USER $SITES_ENABLED" >&2
    exit 1
  fi
fi
if [ ! -s "$SITES_ENABLED/00-placeholder.conf" ]; then
  echo "Error: write to $SITES_ENABLED/00-placeholder.conf failed (file missing or empty). Check path and permissions." >&2
  exit 1
fi

# Sanitize filename: domain only (no path)
CONF_FILE="$SITES_ENABLED/${ADD_DOMAIN}.conf"

# Phase 1: HTTP-only server block (for ACME challenge and proxy until cert exists)
write_http_only() {
  cat > "$CONF_FILE" << NGINX_HTTP
# $ADD_DOMAIN - HTTP only (cert not yet obtained)
server {
    listen 80;
    server_name $ADD_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }

    location ~ ^/api/auth/(login|register|forgot-password|reset-password|verify-email|validate-reset-token) {
        limit_req zone=auth burst=10 nodelay;
        proxy_pass http://harborfm:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    location / {
        limit_req zone=general burst=40 nodelay;
        proxy_pass http://harborfm:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
NGINX_HTTP
  if [ ! -s "$CONF_FILE" ]; then
    echo "Error: failed to write $CONF_FILE (file missing or empty). Check that INSTALL_DIR is correct and $SITES_ENABLED is writable." >&2
    exit 1
  fi
}

# Phase 2: HTTP redirect + HTTPS (after cert exists)
write_http_and_https() {
  cat > "$CONF_FILE" << NGINX_FULL
# $ADD_DOMAIN - HTTP redirect + HTTPS
server {
    listen 80;
    server_name $ADD_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $ADD_DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$ADD_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$ADD_DOMAIN/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location ~ ^/api/auth/(login|register|forgot-password|reset-password|verify-email|validate-reset-token) {
        limit_req zone=auth burst=10 nodelay;
        proxy_pass http://harborfm:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }

    location / {
        limit_req zone=general burst=40 nodelay;
        proxy_pass http://harborfm:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
NGINX_FULL
  if [ ! -s "$CONF_FILE" ]; then
    echo "Error: failed to write $CONF_FILE (file missing or empty). Check that INSTALL_DIR is correct and $SITES_ENABLED is writable." >&2
    exit 1
  fi
}

echo "Adding nginx config for $ADD_DOMAIN (HTTP only)..."
write_http_only

cd "$INSTALL_DIR"
echo "Reloading nginx..."
docker compose exec nginx nginx -s reload

echo "Obtaining Let's Encrypt certificate for $ADD_DOMAIN..."
if ! docker compose run --rm -e DOMAIN="$ADD_DOMAIN" -e CERTBOT_EMAIL="$CERTBOT_EMAIL" certbot; then
  echo "Certbot failed. Nginx config left as HTTP-only at $CONF_FILE. Fix DNS or rate limits and run certbot again." >&2
  exit 1
fi

echo "Switching $ADD_DOMAIN to HTTPS and reloading nginx..."
write_http_and_https
docker compose exec nginx nginx -s reload

echo ""
echo "=== Done ==="
echo "  $ADD_DOMAIN is now served with HTTPS."
echo "  Config: $CONF_FILE"
echo "  Renewal: existing 'docker compose run --rm --entrypoint certbot certbot renew' (or cron) renews all certs including this one."
