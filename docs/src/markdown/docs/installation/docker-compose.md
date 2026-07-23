# Docker Compose

Use Compose for HarborFM plus a reverse proxy (Caddy by default, or nginx), Let's Encrypt, and optional WebRTC.

## Quick Install (No Clone Required)

```bash
curl -fsSL https://raw.githubusercontent.com/loganrickert/harborfm/main/install.sh | bash
```

Follow prompts for domain and reverse proxy. **`install.sh` defaults to Caddy**; nginx is optional (Let's Encrypt or self-signed).

<a id="without-install-sh"></a>

## Install with Docker Compose Without install.sh (Caddy)

This matches what `install.sh` does when you choose **Caddy**: download the Compose stack and Caddy configs, write a `.env`, create data directories, then start with the `caddy` profile. You do not need to clone the full HarborFM repo.

### Prerequisites

- Docker Engine and **Docker Compose v2** (`docker compose version`)
- Your user in the `docker` group (or run as root)
- DNS for your domain pointed at this host (A/AAAA) if you want real HTTPS

### 1. Create an Install Directory

```bash
INSTALL_DIR="$HOME/harborfm-docker"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
```

Use an absolute path; Compose bind mounts and Fail2Ban expect `INSTALL_DIR` in `.env`.

### 2. Download Config Files

Configs come from the `main` branch on GitHub. Adjust `REPO` / `BRANCH` if you use a fork or tag.

```bash
REPO="${HARBORFM_REPO:-loganrickert/harborfm}"
BRANCH="${HARBORFM_BRANCH:-main}"
BASE="https://raw.githubusercontent.com/${REPO}/${BRANCH}"

curl -fsSL "$BASE/docker-compose.yml" -o docker-compose.yml
curl -fsSL "$BASE/caddy/Caddyfile" -o caddy/Caddyfile --create-dirs
curl -fsSL "$BASE/caddy/Caddyfile.webrtc" -o caddy/Caddyfile.webrtc
curl -fsSL "$BASE/fail2ban/filter.d/caddy-scanner.conf" -o fail2ban/filter.d/caddy-scanner.conf --create-dirs
curl -fsSL "$BASE/fail2ban/jail.d/caddy-scanner.local" -o fail2ban/jail.d/caddy-scanner.local --create-dirs
curl -fsSL "$BASE/fail2ban/filter.d/nginx-scanner.conf" -o fail2ban/filter.d/nginx-scanner.conf
curl -fsSL "$BASE/fail2ban/jail.d/nginx-scanner.local" -o fail2ban/jail.d/nginx-scanner.local
curl -fsSL "$BASE/update.sh" -o update.sh
chmod +x update.sh
```

`install.sh` also downloads nginx templates (for the nginx profile). You can skip those if you only run Caddy.

| File | Purpose |
|------|---------|
| `docker-compose.yml` | App, Caddy, Whisper, Fail2Ban, optional WebRTC |
| `caddy/Caddyfile` | Reverse proxy + automatic HTTPS |
| `caddy/Caddyfile.webrtc` | Same as above, plus `/webrtc-ws` proxy (use when enabling WebRTC) |
| `fail2ban/...` | Scanner jails used by the Fail2Ban service |
| `update.sh` | Pull newer configs/images later |

### 3. Create Data Directories

```bash
mkdir -p \
  harborfm-data/data \
  harborfm-data/secrets \
  harborfm-data/webrtc \
  harborfm-data/proxy/caddy/data \
  harborfm-data/proxy/caddy/config \
  harborfm-data/proxy/caddy/logs \
  harborfm-data/whisper/cache

# Fail2Ban expects this log file to exist
touch harborfm-data/proxy/caddy/logs/access.log
```

### 4. Write `.env` (Caddy)

Replace `podcasts.example.com` with your domain. Generate a TLS check secret once and keep it stable across upgrades.

```bash
DOMAIN=podcasts.example.com
CADDY_TLS_CHECK_SECRET="$(openssl rand -hex 32)"

cat > .env <<EOF
# Compose install without install.sh (Caddy)
INSTALL_DIR=$(pwd)
DOMAIN=$DOMAIN
REVERSE_PROXY=caddy
CADDY_TLS_CHECK_SECRET=$CADDY_TLS_CHECK_SECRET
WEBRTC_ENABLED=0
EOF
```

Notes:

- Set `DOMAIN=localhost` for a local try. Caddy still starts; use `http://localhost` and set `COOKIE_SECURE=false` in `.env` if login fails over plain HTTP.
- For a real hostname, point DNS at this machine first. Caddy obtains and renews Let's Encrypt certificates automatically (no certbot).
- Optional: `TZ=America/New_York` (or your zone) for Fail2Ban log timestamps.

### 5. Optional: Enable WebRTC

If you want group calls / remote recording:

1. Copy the WebRTC Caddyfile over the default:

   ```bash
   cp caddy/Caddyfile.webrtc caddy/Caddyfile
   ```

2. Append WebRTC settings to `.env` (generate fresh secrets):

   ```bash
   WEBRTC_SERVICE_SECRET="$(openssl rand -base64 32)"
   RECORDING_CALLBACK_SECRET="$(openssl rand -base64 32)"

   cat >> .env <<EOF
   WEBRTC_ENABLED=1
   WEBRTC_SERVICE_URL=http://webrtc:3002
   WEBRTC_PUBLIC_WS_URL=wss://${DOMAIN}/webrtc-ws
   WEBRTC_SERVICE_SECRET=$WEBRTC_SERVICE_SECRET
   RECORDING_CALLBACK_SECRET=$RECORDING_CALLBACK_SECRET
   EOF
   ```

3. Behind NAT, also set `MEDIASOUP_ANNOUNCED_IP` to the server's public IP (see [Environment Variables](/docs/installation/environment-variables/)).

### 6. Start the Stack

From the install directory (where `.env` lives):

```bash
# App + Caddy + Whisper + Fail2Ban
docker compose --profile caddy up -d

# With WebRTC:
# docker compose --profile caddy --profile webrtc up -d
```

Check that Caddy is up:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1/caddy-health
# expect 200
```

### 7. Finish Setup in the Browser

```bash
docker compose logs harborfm | grep -oE '/setup\?id=[^ ]+' | head -1
```

Open `https://YOUR_DOMAIN/setup?id=...` (or `http://` on localhost), create the admin account, then sign in.

Useful commands (always from the install directory):

```bash
docker compose logs -f
./update.sh
docker compose down
```

## WebRTC Profile

Enable WebRTC during install, or start with the `webrtc` profile alongside your proxy profile:

```bash
docker compose --profile caddy --profile webrtc up -d
# or, if you chose nginx:
docker compose --profile nginx --profile webrtc up -d
```

Set `WEBRTC_ENABLED`, `WEBRTC_SERVICE_URL`, `WEBRTC_PUBLIC_WS_URL`, `WEBRTC_SERVICE_SECRET`, `RECORDING_CALLBACK_SECRET`, and behind NAT `MEDIASOUP_ANNOUNCED_IP`. After Hostname is set in **Settings**, WebRTC Settings values take precedence over `WEBRTC_*` env vars (env still seeds empty settings).

## Updating

`install.sh` also installs **`update.sh`** in the install directory. Run it from that directory to refresh compose configs and images. Configs and images are fetched while the stack stays up; downtime is only the brief recreate step. When `WEBRTC_ENABLED=1`, `update.sh` passes the `webrtc` profile so the webrtc image is pulled and recreated.

Always run `docker compose` from the install directory so paths in `.env` (for example `INSTALL_DIR`) resolve correctly.

## Certificates

- **Caddy** renews certificates itself.
- **nginx + certbot:** renew via cron, for example `docker compose run --rm --entrypoint certbot certbot renew`.

## See Also

- [Docker](/docs/installation/docker/) for a single-container setup
- [Environment Variables](/docs/installation/environment-variables/)
- [Usage: Deployment](/docs/usage/deployment/) for a shorter overview
- [Group calls](/docs/usage/group-calls/) for WebRTC usage in the app
