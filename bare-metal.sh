#!/usr/bin/env bash
# Harbor FM - bare-metal host setup (no Docker). Prepares tools and deps for running the app with pm2/node on port 3001.
# Run from the repo root or after cloning. Loads .env from current directory (pwd) if present; installs nginx/Caddy if missing.
set -e

# Repo root (directory containing this script and bare-metal/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# Load .env from repo root (same dir as this script); fallback to pwd for backwards compat
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$REPO_ROOT/.env"
  set +a
elif [ -f "$PWD/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PWD/.env"
  set +a
fi

echo "=== Harbor FM bare-metal setup ==="
echo ""

# Hostname: prefer DOMAIN from .env, then prompt
DEFAULT_HOSTNAME="${DOMAIN:-}"
read -r -p "Enter hostname for the app (e.g. fm.example.com)${DEFAULT_HOSTNAME:+ [$DEFAULT_HOSTNAME]}: " HARBORFM_HOSTNAME </dev/tty
HARBORFM_HOSTNAME="${HARBORFM_HOSTNAME:-$DEFAULT_HOSTNAME}"

echo ""
echo "Reverse proxy: nginx = you manage SSL (e.g. certbot). Caddy = automatic HTTPS and cert renewal, simpler for multiple/dynamic hostnames."
DEFAULT_PROXY="${REVERSE_PROXY:-nginx}"
read -r -p "Use nginx or Caddy?${DEFAULT_PROXY:+ [$DEFAULT_PROXY]}: " REVERSE_PROXY </dev/tty
REVERSE_PROXY="${REVERSE_PROXY:-$DEFAULT_PROXY}"
if [[ "$REVERSE_PROXY" =~ ^[cC]addy ]]; then
  REVERSE_PROXY=caddy
else
  REVERSE_PROXY=nginx
fi

# Always install these (no prompt)
echo ""
echo "Installing wget, curl, git, ca-certificates..."
if command -v apt-get &>/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y wget curl git ca-certificates
elif command -v dnf &>/dev/null; then
  sudo dnf install -y wget curl git ca-certificates
else
  echo "Warning: unknown package manager. Install wget, curl, git, ca-certificates manually."
fi

# audiowaveform
echo ""
if command -v audiowaveform &>/dev/null; then
  echo "audiowaveform already installed."
else
  read -r -p "Install audiowaveform (waveform generation)? [Y/n] " yn </dev/tty
  if [[ ! "$yn" =~ ^[nN] ]]; then
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ]; then
      DEB_ARCH="amd64"
      RPM_ARCH="x86_64"
    elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      DEB_ARCH="arm64"
      RPM_ARCH="aarch64"
    else
      echo "Unsupported arch: $ARCH. Install audiowaveform manually from https://github.com/bbc/audiowaveform"
    fi
    if [ -n "${DEB_ARCH:-}" ]; then
      if command -v dpkg &>/dev/null; then
        echo "Installing audiowaveform dependencies (libgd3, libboost)..."
        sudo apt-get update -qq
        for BOOST_VER in 1.74.0 1.81.0 1.67.0; do
          sudo apt-get install -y libgd3 libboost-program-options${BOOST_VER} libboost-filesystem${BOOST_VER} libboost-regex${BOOST_VER} 2>/dev/null && break
        done
        sudo apt-get install -y libgd3 2>/dev/null || true
        DEB_FILE="/tmp/audiowaveform.deb"
        for DEB_VER in 13 12 11 10; do
          DEB_URL="https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform_1.10.2-1-${DEB_VER}_${DEB_ARCH}.deb"
          if wget -q --spider "$DEB_URL" 2>/dev/null; then
            wget -q -O "$DEB_FILE" "$DEB_URL" || true
            if [ -s "$DEB_FILE" ]; then
              if sudo dpkg -i "$DEB_FILE"; then
                echo "audiowaveform installed (deb ${DEB_VER})."
                break
              else
                if sudo apt-get -f install -y; then
                  echo "audiowaveform installed (deb ${DEB_VER}, deps fixed)."
                  break
                fi
              fi
            fi
          fi
        done
        rm -f "$DEB_FILE"
        if ! command -v audiowaveform &>/dev/null; then
          echo "audiowaveform install failed. Try: sudo apt install -y libgd3 libboost-program-options1.74.0 libboost-filesystem1.74.0 libboost-regex1.74.0 libmad0 libid3tag0 && sudo dpkg -i /path/to/audiowaveform_1.10.2-1-12_${DEB_ARCH}.deb, or see https://github.com/bbc/audiowaveform/releases"
        fi
      elif command -v rpm &>/dev/null && [ "$ARCH" = "x86_64" ]; then
        RPM_FILE="/tmp/audiowaveform.rpm"
        for EL_VER in 9 8; do
          RPM_URL="https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform-1.10.2-1.el${EL_VER}.x86_64.rpm"
          if wget -q --spider "$RPM_URL" 2>/dev/null; then
            wget -q -O "$RPM_FILE" "$RPM_URL" || true
            if [ -s "$RPM_FILE" ] && sudo rpm -Uvh "$RPM_FILE" 2>/dev/null; then
              echo "audiowaveform installed (el${EL_VER} rpm)."
              break
            fi
          fi
        done
        rm -f "$RPM_FILE"
        if ! command -v audiowaveform &>/dev/null; then
          echo "audiowaveform install failed. Install from https://github.com/bbc/audiowaveform/releases"
        fi
      else
        echo "No dpkg or rpm found. Install audiowaveform manually from https://github.com/bbc/audiowaveform/releases"
      fi
    fi
  fi
fi

# smbclient
echo ""
if command -v smbclient &>/dev/null; then
  echo "smbclient already installed."
else
  read -r -p "Install smbclient? [Y/n] " yn </dev/tty
  if [[ ! "$yn" =~ ^[nN] ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y smbclient
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y samba-client
    else
      echo "Install smbclient (samba-client) manually."
    fi
  fi
fi

# geoipupdate
echo ""
if command -v geoipupdate &>/dev/null; then
  echo "geoipupdate already installed."
else
  read -r -p "Install geoipupdate? [Y/n] " yn </dev/tty
  if [[ ! "$yn" =~ ^[nN] ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y geoipupdate
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y geoipupdate
    else
      echo "Install geoipupdate manually."
    fi
  fi
fi

# ffmpeg
echo ""
if command -v ffmpeg &>/dev/null; then
  echo "ffmpeg already installed."
else
  read -r -p "Install ffmpeg? [Y/n] " yn </dev/tty
  if [[ ! "$yn" =~ ^[nN] ]]; then
    if command -v apt-get &>/dev/null; then
      sudo apt-get install -y ffmpeg
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y ffmpeg
    else
      echo "Install ffmpeg manually."
    fi
  fi
fi

# Node 22
echo ""
if command -v node &>/dev/null && node -v 2>/dev/null | grep -q 'v22'; then
  echo "Node.js 22 already installed."
else
  read -r -p "Install Node.js 22? [Y/n] " yn </dev/tty
  if [[ ! "$yn" =~ ^[nN] ]]; then
    if command -v curl &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      if command -v apt-get &>/dev/null; then
        sudo apt-get install -y nodejs
      elif command -v dnf &>/dev/null; then
        sudo dnf install -y nodejs
      fi
      echo "Node.js 22 installed."
    else
      echo "Install Node.js 22 manually from https://nodejs.org/"
    fi
  fi
fi

# pnpm
echo ""
if command -v pnpm &>/dev/null; then
  echo "pnpm already installed."
else
  read -r -p "Install pnpm? [Y/n] " yn </dev/tty
  if [[ ! "$yn" =~ ^[nN] ]]; then
    if command -v corepack &>/dev/null; then
      sudo corepack enable
      sudo corepack prepare pnpm@latest --activate
      echo "pnpm installed."
    else
      echo "corepack not found (need Node.js). Install Node.js first, then run: corepack enable && corepack prepare pnpm@latest --activate"
    fi
  fi
fi

# Optionally copy nginx/Caddy config to /etc with hostname replaced and reload
echo ""
read -r -p "DANGER: Copy $REVERSE_PROXY config to /etc/nginx/nginx.conf or /etc/caddy/Caddyfile with your hostname and reload the service? (requires $REVERSE_PROXY to be installed) [y/N] " do_copy </dev/tty
if [[ "$do_copy" =~ ^[yY] ]] && [ -n "$HARBORFM_HOSTNAME" ]; then
  if [ "$REVERSE_PROXY" = "caddy" ]; then
    SRC="$REPO_ROOT/bare-metal/Caddyfile"
    DEST="/etc/caddy/Caddyfile"
    if [ ! -f "$SRC" ]; then
      echo "Source not found: $SRC (run this script from the repo that contains bare-metal/)."
    else
      if ! command -v caddy &>/dev/null; then
        echo "Caddy not installed. Installing Caddy from official repository..."
        if command -v apt-get &>/dev/null; then
          sudo apt-get update -qq
          sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
          curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
            | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
          curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
            | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
          sudo apt-get update -qq
          sudo apt-get install -y caddy
          echo "Caddy installed."
        else
          echo "Caddy not installed and apt not available. Install Caddy manually, then re-run this script or copy the config yourself."
        fi
      fi
      if command -v caddy &>/dev/null; then
        sudo mkdir -p "$(dirname "$DEST")"
        sed "s|YOUR_HOSTNAME|$HARBORFM_HOSTNAME|g" "$SRC" | sudo tee "$DEST" >/dev/null
        echo "Wrote $DEST with hostname $HARBORFM_HOSTNAME"
        if sudo systemctl reload caddy 2>/dev/null; then
          echo "Caddy reloaded."
        elif sudo systemctl start caddy 2>/dev/null; then
          echo "Caddy started."
        else
          echo "Reload/start failed. Try: sudo systemctl start caddy  # or: sudo systemctl reload caddy"
        fi
      fi
    fi
  else
    SRC="$REPO_ROOT/bare-metal/nginx.conf"
    DEST="/etc/nginx/nginx.conf"
    if [ ! -f "$SRC" ]; then
      echo "Source not found: $SRC (run this script from the repo that contains bare-metal/)."
    else
      if [ ! -d "$(dirname "$DEST")" ] || ! command -v nginx &>/dev/null; then
        echo "Nginx not installed. Installing nginx..."
        if command -v apt-get &>/dev/null; then
          sudo apt-get update -qq
          sudo apt-get install -y nginx
          echo "Nginx installed."
        else
          echo "Nginx not installed and apt not available. Install nginx manually, then re-run this script or copy the config yourself."
        fi
      fi
      if [ -d "$(dirname "$DEST")" ]; then
        sed "s|YOUR_HOSTNAME|$HARBORFM_HOSTNAME|g" "$SRC" | sudo tee "$DEST" >/dev/null
        echo "Wrote $DEST with hostname $HARBORFM_HOSTNAME"
        if sudo systemctl reload nginx 2>/dev/null; then
          echo "Nginx reloaded."
        elif sudo systemctl start nginx 2>/dev/null; then
          echo "Nginx started."
        else
          echo "Reload/start failed. Try: sudo systemctl start nginx  # or: sudo systemctl reload nginx"
        fi
      fi
    fi
  fi
elif [[ "$do_copy" =~ ^[yY] ]] && [ -z "$HARBORFM_HOSTNAME" ]; then
  echo "Hostname was not set; skipping config copy. Run the script again with a hostname, or copy and edit the config manually."
fi

echo ""
echo "=== Next steps ==="
echo "1. Clone the repo (if not already): git clone https://github.com/loganrickert/harborfm.git && cd harborfm"
echo "2. Install deps: pnpm install"
echo "3. Build: pnpm run build (or see package.json scripts)"
echo "4. Run the app on port 3001 (e.g. PORT=3001 pnpm run start:server or pm2 start ...)"
echo "5. Install and configure the reverse proxy:"
if [ "$REVERSE_PROXY" = "caddy" ]; then
  echo "   - Install Caddy, then copy bare-metal/Caddyfile to /etc/caddy/Caddyfile"
  echo "   - Replace YOUR_HOSTNAME with: ${HARBORFM_HOSTNAME:-your-domain}"
  echo "   - Reload Caddy: sudo systemctl reload caddy"
else
  echo "   - Install nginx and certbot, then copy bare-metal/nginx.conf to /etc/nginx/nginx.conf (or include it)"
  echo "   - Replace YOUR_HOSTNAME with: ${HARBORFM_HOSTNAME:-your-domain}"
  echo "   - Obtain cert: sudo certbot certonly --webroot -w /var/www/certbot -d ${HARBORFM_HOSTNAME:-your-domain}"
  echo "   - Reload nginx: sudo systemctl reload nginx"
fi
echo ""
