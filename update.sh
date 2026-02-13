#!/usr/bin/env bash
# Harbor FM - update configs from main and refresh containers
# Run from the install directory (where docker-compose.yml lives), or pass path as first argument.
# Usage: ./update.sh [install-dir]
set -e

# Install directory: first argument or directory containing this script
INSTALL_DIR="${1:-$(cd -P "$(dirname "$0")" && pwd)}"
INSTALL_DIR="$(cd -P "$(dirname "$INSTALL_DIR")" && pwd)/$(basename "$INSTALL_DIR")"

HARBORFM_REPO="${HARBORFM_REPO:-loganrickert/harborfm}"
HARBORFM_BRANCH="${HARBORFM_BRANCH:-main}"
BASE_URL="https://raw.githubusercontent.com/${HARBORFM_REPO}/${HARBORFM_BRANCH}"

echo "=== Harbor FM update ==="
echo "Install directory: $INSTALL_DIR"
echo ""

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  echo "Error: docker-compose.yml not found in $INSTALL_DIR. Run install.sh first or pass the install path." >&2
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "Error: docker is not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "Error: docker compose is not available." >&2
  exit 1
fi

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

cd "$INSTALL_DIR"

# Load .env for REVERSE_PROXY and certbot decision
if [ -f "$INSTALL_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$INSTALL_DIR/.env"
  set +a
fi
REVERSE_PROXY="${REVERSE_PROXY:-nginx}"

echo "Stopping containers..."
docker compose down

echo "Downloading latest configs from GitHub (main)..."
read -r -p "Overwrite docker-compose.yml with version from GitHub? [y/N] " overwrite_compose </dev/tty || true
if [[ "$overwrite_compose" =~ ^[yY] ]]; then
  download "$BASE_URL/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
else
  echo "Skipping docker-compose.yml (unchanged)."
fi
download "$BASE_URL/nginx/entrypoint.sh" "$INSTALL_DIR/nginx/entrypoint.sh"
download "$BASE_URL/nginx/nginx-80-only.conf.template" "$INSTALL_DIR/nginx/nginx-80-only.conf.template"
download "$BASE_URL/nginx/nginx-full.conf.template" "$INSTALL_DIR/nginx/nginx-full.conf.template"
download "$BASE_URL/caddy/Caddyfile" "$INSTALL_DIR/caddy/Caddyfile"
download "$BASE_URL/fail2ban/filter.d/nginx-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/nginx-scanner.conf"
download "$BASE_URL/fail2ban/jail.d/nginx-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/nginx-scanner.local"
download "$BASE_URL/fail2ban/filter.d/caddy-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/caddy-scanner.conf"
download "$BASE_URL/fail2ban/jail.d/caddy-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/caddy-scanner.local"
download "$BASE_URL/update.sh" "$INSTALL_DIR/update.sh"
download "$BASE_URL/nginx-add-domain.sh" "$INSTALL_DIR/nginx-add-domain.sh"
chmod +x "$INSTALL_DIR/nginx/entrypoint.sh"
chmod +x "$INSTALL_DIR/update.sh"
chmod +x "$INSTALL_DIR/nginx-add-domain.sh"
echo "Configs updated."
echo ""

# Ensure nginx sites-enabled exists with placeholder (for existing installs that added this later)
mkdir -p "$INSTALL_DIR/harborfm-docker-data/nginx/sites-enabled"
placeholder="$INSTALL_DIR/harborfm-docker-data/nginx/sites-enabled/00-placeholder.conf"
if [ ! -f "$placeholder" ]; then
  echo '# Additional sites; add .conf files here (e.g. via nginx-add-domain.sh).' > "$placeholder"
  echo "Created nginx sites-enabled placeholder."
fi

# Fail2ban caddy-scanner jail requires this file; create so fail2ban starts when only nginx is used
mkdir -p "$INSTALL_DIR/harborfm-docker-data/caddy/logs"
touch "$INSTALL_DIR/harborfm-docker-data/nginx/logs/access.log" 2>/dev/null || true
touch "$INSTALL_DIR/harborfm-docker-data/caddy/logs/access.log" 2>/dev/null || true

echo "Pulling images..."
docker compose pull

echo "Starting containers (profile: $REVERSE_PROXY)..."
docker compose --profile "$REVERSE_PROXY" up -d

if [ "$REVERSE_PROXY" = "nginx" ] && [ -n "${CERTBOT_EMAIL:-}" ] && [ "${DOMAIN:-localhost}" != "localhost" ]; then
  echo ""
  echo "Attempting Let's Encrypt certificate renewal..."
  if docker compose run --rm --entrypoint certbot certbot renew; then
    echo "Renewal finished. Nginx will reload within ~60 seconds if certs were renewed."
  else
    echo "Certbot renew completed (no action or rate limit)."
  fi
fi

echo ""
echo "=== Update complete ==="
echo "  Logs:  docker compose logs -f"
echo "  Stop:  docker compose down"
