#!/usr/bin/env bash
# Harbor FM — update configs from main and refresh containers
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

echo "Stopping containers..."
docker compose down

echo "Downloading latest configs from GitHub (main)..."
download "$BASE_URL/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
download "$BASE_URL/nginx/entrypoint.sh" "$INSTALL_DIR/nginx/entrypoint.sh"
download "$BASE_URL/nginx/nginx-80-only.conf.template" "$INSTALL_DIR/nginx/nginx-80-only.conf.template"
download "$BASE_URL/nginx/nginx-full.conf.template" "$INSTALL_DIR/nginx/nginx-full.conf.template"
download "$BASE_URL/fail2ban/filter.d/nginx-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/nginx-scanner.conf"
download "$BASE_URL/fail2ban/jail.d/nginx-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/nginx-scanner.local"
download "$BASE_URL/update.sh" "$INSTALL_DIR/update.sh"
chmod +x "$INSTALL_DIR/nginx/entrypoint.sh"
chmod +x "$INSTALL_DIR/update.sh"
echo "Configs updated."
echo ""

echo "Pulling images..."
docker compose pull

echo "Starting containers..."
docker compose up -d

# Load .env for certbot decision
if [ -f "$INSTALL_DIR/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$INSTALL_DIR/.env"
  set +a
fi

if [ -n "${CERTBOT_EMAIL:-}" ] && [ "${DOMAIN:-localhost}" != "localhost" ]; then
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
