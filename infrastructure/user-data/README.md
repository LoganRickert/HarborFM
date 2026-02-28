# HarborFM user-data scripts

First-boot scripts to deploy a new HarborFM instance. Use as **EC2 user-data** or **Vultr user-data** (or any cloud that supports passing a script at instance creation).

## Script

A single unified script handles all OS and deploy-type combinations:

| Script | Description |
|--------|-------------|
| `harborfm-user-data.sh` | Unified script for all supported OSes and deploy types |

**Required environment variables** (passed by Terraform or caller):

| Variable | Values | Description |
|----------|--------|-------------|
| `OS` | `debian-12`, `ubuntu-24`, `ubuntu-25`, `centos-9` | Target OS. Auto-detected from `/etc/os-release` if unset. |
| `DEPLOY_TYPE` | `pm2`, `nginx`, `caddy` | Deploy type (bare metal or Docker). |

**Supported combinations:**

| OS        | nginx (Docker) | caddy (Docker) | pm2 (bare metal) |
|-----------|----------------|-----------------|------------------|
| Debian 11 | ✓ | ✓ | ✓ |
| Debian 12 | ✓ | ✓ | ✓ |
| Ubuntu 22 | ✓ | ✓ | ✓ |
| Ubuntu 24 | ✓ | ✓ | ✓ |
| CentOS 9  | ✓ | ✓ | ✓ |

- **nginx / caddy:** Install Docker and Docker Compose, download HarborFM compose and configs from GitHub, then run `docker compose --profile nginx` or `--profile caddy` (includes app, reverse proxy, Whisper, Fail2Ban). When running as root, the script creates a non-root user (`harborfm` by default, overridable via `NEW_USER`), copies SSH keys, and re-execs. UFW is installed and configured to allow SSH (22), HTTP (80), HTTPS (443), WebRTC HTTP (3002), and WebRTC RTC ports (41000–41100/udp). After startup, `INSTALL_DIR/setup.txt` is written with the setup URL for user reference.
- **pm2:** Install Node 22, pnpm, PM2; clone the repo, build, and run under PM2. Includes nginx or Caddy as reverse proxy. UFW and fail2ban are configured.

## Environment variables

Set these when possible (e.g. via Terraform `user_data_env` or cloud-init) so the script can use them. Defaults are applied if unset.

| Variable | Default | Description |
|----------|---------|-------------|
| `OS` | (auto-detect) | OS identifier. Required if Terraform does not pass it. |
| `DEPLOY_TYPE` | `pm2` | Deploy type. |
| `DOMAIN` | `localhost` (Docker) / `_` (PM2) | Hostname for the app (and for nginx/caddy/certbot). |
| `CERTBOT_EMAIL` | (empty) | Email for Let's Encrypt (nginx profile only). If set and DOMAIN is not localhost, certbot runs after compose up. |
| `TZ` | `UTC` | Timezone (e.g. `America/New_York`) for fail2ban. |
| `SETUP_ID` | (empty) | Optional setup token. If set, passed to the app and written to `setup.txt` as the setup URL. If unset, the script reads the token from `harborfm-data/data/setup-token.txt` (after server startup) and writes `INSTALL_DIR/setup.txt`. PM2 and Docker share the same data layout (`data`, `secrets`, `webrtc`) for seamless deploy-type switching. |
| `WEBRTC_ENABLED` | `0` | When `1`, enables the WebRTC profile (`--profile webrtc`). |
| `REVERSE_PROXY` | `nginx` | PM2 only: reverse proxy (`nginx` or `caddy`). |
| `NEW_USER` | `harborfm` | When the script runs as root (Docker), creates this non-root user, copies SSH keys, and re-execs as that user. |
| `PM2_USER` | `harborfm` | PM2 deploy: user to run the app (creates if missing). PM2, migrations, and seed run as this user. |
| `INSTALL_DIR` | `/opt/harborfm-docker` (Docker) or `/opt/harborfm` (PM2) | Where to install. |
| `HARBORFM_REPO` | `loganrickert/harborfm` | GitHub repo (owner/name). |
| `HARBORFM_BRANCH` | `main` | Branch to use for configs (Docker) or clone (PM2). |
| `DATA_DIR` | (PM2 only) `/var/lib/harborfm/data` | App data directory for PM2 deploy. |
| `SECRETS_DIR` | (PM2 only) `/var/lib/harborfm/secrets` | Secrets directory for PM2 deploy. |
| `JWT_SECRET` / `HARBORFM_SECRETS_KEY` | (PM2 only) | Auto-generated if not set. |

## Usage

- **Terraform (Vultr/AWS):** Uses `harborfm-user-data.sh` and passes `OS`, `DEPLOY_TYPE`, and other vars via `user_data_env`. Ensure the instance image matches `OS` (e.g. Debian 12 for `debian-12`).
- **AWS EC2 (manual):** In Launch Instance, under “Advanced details”, paste the script and prefix with exports, e.g. `export OS=debian-12; export DEPLOY_TYPE=nginx; ...` (then the script body). Ensure the AMI matches `OS`.
- **Vultr (manual):** When creating an instance, select the matching OS image, paste the script with env vars prefixed into the user-data field.

After boot, open the app at `http://<instance-ip>/` (Docker nginx/caddy) or `http://<instance-ip>:3001/` (PM2). For a real domain and HTTPS with nginx, set `DOMAIN` and `CERTBOT_EMAIL` and ensure DNS points to the instance before or shortly after first boot.
