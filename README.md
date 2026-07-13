# HarborFM

![HarborFM](web/public/og-image.png)

Open source podcast creation tool designed as a modern replacement for Anchor.fm. Build episodes from segments: record or upload clips, pull in intros and bumpers from a library, trim and reorder, then export a single audio file and RSS feed.

The app has PWA, so you can add it to your home screen and connect to your server.

**License:** MIT

**Home Page:** [https://harborfm.com/](https://harborfm.com)

**Source:** [https://github.com/LoganRickert/harborfm](https://github.com/LoganRickert/harborfm)

**Demo Site:** [https://app.harborfm.com/](https://app.harborfm.com)

**Swagger API Docs:** [https://harborfm.com/server/](https://harborfm.com/server/)

**Overview on Noted.lol** [https://noted.lol/harborfm/](https://noted.lol/harborfm/)

**Discord** [https://discord.gg/hSmstBzAJV](https://discord.gg/hSmstBzAJV)

## YouTube Tutorials

### Quick Install and First Podcast
[![HarborFM Quick Start](https://img.youtube.com/vi/WMLN44gbbKc/hqdefault.jpg)](https://youtu.be/WMLN44gbbKc)

### Recording Your First Episode
[![HarborFM Quick Start](https://img.youtube.com/vi/Qf-U95wzTBY/hqdefault.jpg)](https://youtu.be/Qf-U95wzTBY)

## Table of contents

- [Overview](#overview)
- [Deploy with Terraform](#deploy-with-terraform)
- [WebRTC (group calls)](#webrtc-group-calls)
- [Requirements](#requirements)
- [Quick start (local)](#quick-start-local)
- [Docker](#docker)
- [Environment variables](#environment-variables)
- [Running without Docker](#running-without-docker)
- [Features](#features)
- [Embed](#embed)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Export](#export)
- [Local Testing](#local-testing)
- [Troubleshooting](#troubleshooting)
- [Backup and upgrading](#backup-and-upgrading)
- [Single Sign-On (SSO)](#single-sign-on-sso)

## Overview

HarborFM lets you assemble podcast episodes from building blocks. Create a show, add episodes, and for each episode add segments: recorded clips (uploaded per episode) or reusable assets from your library (intros, outros, bumpers). Trim, split, remove silence, and reorder. The app concatenates segments with ffmpeg and produces the final episode audio. Generate RSS feeds and deploy to S3-compatible storage (e.g. Cloudflare R2) so listeners can subscribe. Optional: transcripts via Whisper ASR, LLM helpers (Ollama or OpenAI) for copy suggestions, and public feed pages for discovery.

### Quick Start

The app expects two writable directories: `/data` (SQLite DB, uploads, processed audio, RSS, artwork, library) and `/secrets` (JWT and encryption keys). You do not need to mount `/secrets` if you pass the secrets in through environment variables.

```bash
HARBORFM_SECRETS_KEY=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)

docker run --name harborfm -p 3001:3001 \
  -v harborfm-data:/data \
  -e HARBORFM_SECRETS_KEY="$HARBORFM_SECRETS_KEY" \
  -e JWT_SECRET="$JWT_SECRET" \
  ghcr.io/loganrickert/harborfm:latest
```

Use nginx+letsencrypt to provide a secure connection.

If you are using `http`, you need to set `COOKIE_SECURE=false` as an environment variable.

### Deploy with Terraform

Use Terraform to provision a VM (AWS EC2 or Vultr) that runs HarborFM via user-data (PM2 + nginx, with optional WebRTC and Let's Encrypt).

#### AWS (EC2)

1. **Install Terraform** – see [infrastructure/terraform/QUICKSTART.md](infrastructure/terraform/QUICKSTART.md) (macOS, Debian, CentOS).
2. **Configure AWS** – set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (or use `aws configure`).
3. **Apply** from the AWS Terraform directory:

   ```bash
   cd infrastructure/terraform/aws
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars: deploy_type, ami_id (Debian 12 for your region), domain, admin_email, admin_password, etc.
   ./run.sh init
   ./run.sh apply
   ```

4. Use the **url** output to open the app; if you set `admin_email` and `admin_password`, the admin is created on first boot.

#### Vultr

1. **Install Terraform** – see [infrastructure/terraform/QUICKSTART.md](infrastructure/terraform/QUICKSTART.md).
2. **Set** `VULTR_API_KEY` in `.env` (copy from `infrastructure/terraform/.env.example`).
3. **Apply** from the Vultr directory:

   ```bash
   cd infrastructure/terraform/vultr
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars: deploy_type, region, os_id, plan, domain, etc.
   ./run.sh init
   ./run.sh apply
   ```

#### Getting Vultr OS IDs

List available OS images:

```bash
curl -s -H "Authorization: Bearer $VULTR_API_KEY" https://api.vultr.com/v2/os | jq '.os[] | {id, name}'
```

Common mappings: Debian 11 `477`, Debian 12 `2136`, Debian 13 `2625`; Ubuntu 22 `1743`, Ubuntu 24 `2285`, Ubuntu 25 `2657`; CentOS 9 `542`, CentOS 10 `2467`. Vultr derives the `os` variable from `os_id` via [infrastructure/terraform/vultr/scripts/os-from-id.sh](infrastructure/terraform/vultr/scripts/os-from-id.sh).

#### Getting AWS AMI IDs

Look up a Debian 12 AMI for your region (owner `136693071363` is Debian):

```bash
aws ec2 describe-images --region us-east-2 --owners 136693071363 \
  --filters "Name=name,Values=debian-12-*" "Name=state,Values=available" \
  --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text
```

Change `us-east-2` to your region. The Terraform `os` variable (e.g. `debian-12`) must match the image.

Full variable reference, optional persistent data volume (survives destroy+apply), and multi-environment (dev/prod) details: **[infrastructure/terraform/README.md](infrastructure/terraform/README.md)**.

### WebRTC (group calls)

Group calls use a separate **webrtc-service** (mediasoup). The main app talks to it over HTTP; browsers connect via WebSocket.

**Enabling:**

- Set `WEBRTC_ENABLED=1` (or `true`) on the main app.
- Configure `WEBRTC_SERVICE_URL` (internal, e.g. `http://webrtc:3002`) and `WEBRTC_PUBLIC_WS_URL` (public, e.g. `wss://example.com/webrtc-ws`). Nginx/Caddy proxy `/webrtc-ws/` to the webrtc service.

**Docker Compose:** WebRTC runs under profile `webrtc`. Start with:

```bash
docker compose --profile nginx --profile webrtc up -d
```

(or `caddy` instead of `nginx`). Required .env: `WEBRTC_ENABLED`, `WEBRTC_SERVICE_URL`, `WEBRTC_PUBLIC_WS_URL`, `WEBRTC_SERVICE_SECRET`, `RECORDING_CALLBACK_SECRET`, and `MEDIASOUP_ANNOUNCED_IP` (when behind NAT).

**PM2 / bare metal:** Use [ecosystem.config.cjs](ecosystem.config.cjs); it starts both `harborfm` and `webrtc`. Ensure the firewall allows UDP `RTC_MIN_PORT`–`RTC_MAX_PORT` (webrtc-service default 40000–40200; Docker uses 41000–41100).

**Debugging:**

- No "Record" or group-call UI: check `WEBRTC_ENABLED` and `WEBRTC_SERVICE_URL` / `WEBRTC_PUBLIC_WS_URL`.
- Can't connect / no audio: verify firewall UDP ports; behind NAT, set `MEDIASOUP_ANNOUNCED_IP` to the server's public IP.
- Logs: `docker compose logs webrtc` or `pm2 logs webrtc`.

### Docker Compose Quick Start (Curl)

To run the full stack on a fresh machine (app, nginx, Let's Encrypt, Whisper, Fail2Ban) without cloning the repo:

```bash
curl -fsSL https://raw.githubusercontent.com/loganrickert/harborfm/main/install.sh | bash
```

The script downloads the compose file and configs, prompts for domain and cert email (unless non-interactive), then starts the stack. When not using Let's Encrypt, you can optionally use a self-signed certificate for HTTPS (browsers will show a warning). This script assumes you have docker and docker compose installed.

To auto-renew Let's Encrypt certificates, add a cron job (run `crontab -e` and add a line like the following, adjusting the path to your install directory):

```bash
0 3 * * * cd /path/to/harborfm-docker && docker compose run --rm --entrypoint certbot certbot renew
```

If you use the `install.sh` script, an `update.sh` script will also be added to the install directory. Run this script to pull the latest docker-compose files and renew the nginx certificate. Always run `docker compose` (and `docker compose restart`) from the install directory so volume paths such as nginx `sites-enabled` use the correct path from `.env`.

#### Adding additional domains (nginx)

If you use nginx and want to serve the same HarborFM app on extra domains or subdomains (e.g. `demo.harborfm.com`, `podcast.example.com`), use the included script from your **install directory**:

```bash
./nginx-add-domain.sh <domain>
# Example:
./nginx-add-domain.sh demo.harborfm.com
```

**Before running:**

- Your `.env` must have `REVERSE_PROXY=nginx`, `CERTBOT_EMAIL` set, and `INSTALL_DIR` set to the install directory’s absolute path.
- DNS for the new domain must already point to this server (A/AAAA to the same host as your main domain).

The script will: add an nginx config for the domain under `sites-enabled`, reload nginx, run Let’s Encrypt (certbot) to obtain a certificate for that domain, then switch the config to HTTPS and reload again. Your primary domain (the one in `DOMAIN` in `.env`) is already served by the main nginx config-do not add it with this script or you’ll get duplicate server name warnings. Certificate renewal (e.g. cron with `docker compose run --rm --entrypoint certbot certbot renew`) renews all certs, including ones added this way.

### Guide and Screenshots 

![HarborFM](screenshots/screenshot_0.jpg)

When creating a new instance, you will need to navigate to the correct setup link. The link will be written to the console and is unique to every instance.

For example,

```
Open this URL to initialize the server (runs once):

  /setup?id=oFwK--nBt8YloIVABKA4nOmYy_Kbx7PS
```

![HarborFM](screenshots/screenshot_1.jpg)

The initial setup will create an admin account. You will need to provide the admin email, a password, and you can enable or disable account registration and public feeds from here.

After you've finished the setup, you can sign into your new account.

![HarborFM](screenshots/screenshota_0.jpg)

Once signed in, you will see the dashboard which has a list of podcast shows.

![HarborFM](screenshots/screenshota_1.jpg)

For each show, you can configure the information on the show page.

![HarborFM](screenshots/screenshota_2.jpg)

From there you can view and create episodes on the episodes page.

![HarborFM](screenshots/screenshota_3.jpg)

The app provides the ability to 'build' a podcast from a list of audio segments. You can either record a new section or insert audio from an existing audio file you already have.

![HarborFM](screenshots/screenshota_4.jpg)

When you go to record a segment, you can click on the record button and just talk away. When done, click stop. You will have the option to listen to it back, try again, or add it to the end of the list.

![HarborFM](screenshots/screenshot_5.jpg)

When inserting from a library, you will see a list of the audio files you've uploaded before. You can upload audio from this screen as well. Just click the clip you want to use.

![HarborFM](screenshots/screenshot_6.jpg)

Once a new segment is added, if you have Whisper enabled, you can generate a transcript and then view it. You can listen back to just that segment of the transcript and even delete that part of the audio if you'd like.

![HarborFM](screenshots/screenshot_8.jpg)

If you have a transcript, you can also prompt an LLM about the segment in order to get tips, feedback, or questions about the segment.

![HarborFM](screenshots/screenshot_9.jpg)

You also have the option to trim the start and end of a segment. You can also remove silence or apply noise suppression to the clip. The remove silence will remove any silence that lasts longer than 1.5 seconds. 

![HarborFM](screenshots/screenshot_10.jpg)

Once you're finished building your episode, at the bottom you can click "Make Final Episode" and this will generate the final audio file. You can customize the settings, such as mono or stereo, on the site settings page. Whenever you change your podcast and are ready for a new version, just click it again. Once you've generated a final episode, an option to download it will appear so you can upload it to other platforms or share it before publishing.

![HarborFM](screenshots/screenshota_5.jpg)

Once you're happy with a change or a new episode, you can configure the podcast to uploaded to a remote server on the podcast show page. You have the ability to deploy to S3, FTP, SFTP, WebDAV, IPFS, and SMB. The configuration is encrypted at rest with the `HARBORFM_SECRETS_KEY` key. If you push your podcast to a remote server, the built in analytics page will not record any information for files or feeds served from those remote servers.

![HarborFM](screenshots/screenshota_6.jpg)

You can view, edit, and delete audio files in your library on the library page.

![HarborFM](screenshots/screenshota_7.jpg)

Admins can view a list of users on the users page. You can view the list of podcasts for a user, their library, and edit their information from this page. You can change their password or disable/enable their account. You can also configure a limit for max podcasts, max episodes, and max storage.

![HarborFM](screenshots/screenshota_8.jpg)

Admins have access to a global settings page where they can manage:

- Account registration (enable/disable)
- Public feeds (enable/disable)
- Welcome banner
- Default limits for new users
- Episode output options
- GeoLite2
- Whisper ASR
- LLMs
- Captcha
- Email

![HarborFM](screenshots/screenshota_9.jpg)

All users can view a profile page where they can see their basic account information. This page also has a list of the user's API keys.

![HarborFM](screenshots/screenshota_10.jpg)

Lastly, there is an analytics page for views and listens on the public feed. HarborFM classifies traffic as listeners vs crawlers (directory agents and bots) and skips tiny audio probes; overview charts emphasize listeners. Treat the numbers as a general feel rather than a specialized analytics product. Remote exports (S3, FTP, and so on) are not counted.

![HarborFM](screenshots/screenshota_11.jpg)

## Requirements

- **Node.js** 22 or newer
- **pnpm** (recommended; the repo uses pnpm workspaces)
- **ffmpeg**
- **audiowaveform** ([bbc/audiowaveform](https://github.com/bbc/audiowaveform)) - e.g. on macOS: `brew install audiowaveform`; on Linux, build from source or use a package if available
- **node-canvas** (used for episode video waveform): on macOS `brew install pkg-config cairo pango libpng jpeg giflib librsvg`; on Debian/Ubuntu `apt-get install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev` (needed to build the `canvas` npm package, `pnpm -C node_modules/.pnpm/canvas@3.2.1/node_modules/canvas run install`)

## Quick start (local)

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/LoganRickert/harborfm.git
   cd harborfm
   pnpm install
   ```

2. Run migrations:

   ```bash
   pnpm run db:migrate
   ```

3. Start the app:

   ```bash
   pnpm run dev
   ```

   This runs the API and the web dev server. Open the URL shown (e.g. http://localhost:5173). On first run, get the one-time setup URL from the server logs (e.g. `/setup?id=...`), open it in the browser, create the admin account, then sign in.

## Docker

You can build and run HarborFM as a single container. The image includes Node 22, ffmpeg, and the built app; the server serves both the API and the static web app.

### Build

From the repo root:

```bash
docker build -t harborfm .
```

Or use the root script:

```bash
pnpm run docker:build
```

### Run

The app expects two writable directories: `/data` (SQLite DB, uploads, processed audio, RSS, artwork, library) and `/secrets` (JWT and encryption keys). Mount them independently:

```bash
docker run -d \
  --name harborfm \
  -p 3001:3001 \
  -v harborfm-data:/data \
  -v harborfm-secrets:/secrets \
  harborfm
```

Then open http://localhost:3001 (or your host and port). On first run, migrations run automatically. The one-time setup URL is printed in the container logs; open it to create the admin account, then sign in.

### Docker environment variables

All environment variables supported by the server work the same in Docker. Set them with `-e` or an env file. The table below matches `server/src/config.ts`, `server/src/services/paths.ts`, and related server code.

| Variable | Default | Description |
|----------|---------|-------------|
| **Server** | | |
| `PORT` | `3001` | Port the server listens on |
| `HOST` | `0.0.0.0` | Listen host |
| `LOGGER` | (true) | Set to `false` or `0` to disable Fastify logger |
| `TRUST_PROXY` | (true) | Set to `false` or `0` when not behind a reverse proxy |
| `API_PREFIX` | `api` | API path segment; routes live under `/${API_PREFIX}/` |
| `CORS_ORIGIN` | (auto) | `true`/`1` to allow request origin; in production default is false |
| **Paths** | | |
| `DATA_DIR` | `./data` | Directory for DB, uploads, processed audio, RSS, artwork, library (Docker: often `/data`) |
| `SECRETS_DIR` | `./secrets` | Directory for jwt-secret.txt and secrets-key.txt (Docker: often `/secrets`) |
| `PUBLIC_DIR` | `./public` | Directory to serve static web app from |
| `DB_FILENAME` | (from APP_NAME) | SQLite filename under DATA_DIR (e.g. `harborfm.db`) |
| **Secrets & cookies** | | |
| `JWT_SECRET` | (none) | Secret for signing JWTs; required in production (use a long random string) |
| `HARBORFM_SECRETS_KEY` | (none) | Optional key for encrypting export credentials (base64/base64url) |
| `COOKIE_SECURE` | (auto) | Set to `true` when using HTTPS so cookies are Secure; in production default is true if unset |
| `NODE_ENV` | (development) | Set to `production` in Docker; affects CORS and cookie Secure default |
| `CSRF_COOKIE_NAME` | (from APP_NAME) | Name of the CSRF cookie |
| `CSRF_COOKIE_MAX_AGE_SECONDS` | `604800` | CSRF cookie max age (7 days) |
| `JWT_COOKIE_NAME` | (from APP_NAME) | Name of the JWT session cookie |
| `JWT_COOKIE_SIGNED` | (false) | Set to `true` or `1` to sign the JWT cookie (requires @fastify/cookie secret) |
| **Recording & storage** | | |
| `RECORD_MIN_FREE_MB` | `5` | Min free storage (MB) required to record a new section |
| **WebRTC** | | |
| `WEBRTC_ENABLED` | (false) | Set to `1` or `true` to enable group calls |
| `WEBRTC_SERVICE_URL` | (none) | Internal URL to webrtc service (e.g. `http://webrtc:3002`) |
| `WEBRTC_PUBLIC_WS_URL` | (none) | Public WebSocket base for clients (e.g. `wss://example.com/webrtc-ws`). Seeds Settings when empty; Settings values take precedence once set |
| `WEBRTC_SERVICE_SECRET` | (none) | Optional; auth header for server to webrtc HTTP requests |
| `WEBRTC_RECORDINGS_DIR` | `{DATA_DIR}/webrtc-recordings` | Directory for webrtc recording output; server reads from here |
| `RECORDING_CALLBACK_SECRET` | (none) | Secret for webrtc to server recording callback auth |
| `HOST_AWAY_GRACE_NO_GUESTS_MS` | `60000` | Host-away grace period (ms) when no guests |
| `HOST_AWAY_GRACE_NO_GUESTS_RECORDING_MS` | `120000` | Host-away grace (ms) when recording, no guests |
| `HOST_AWAY_GRACE_WITH_GUESTS_MS` | `300000` | Host-away grace (ms) when guests present |
| `HOST_AWAY_CHECK_INTERVAL_MS` | `30000` | Host-away checker interval (ms) |
| **RSS & sitemap** | | |
| `RSS_CACHE_MAX_AGE_MS` | `3600000` | RSS/sitemap cache max age in ms (1 hour) |
| `RSS_FEED_FILENAME` | `feed.xml` | RSS feed filename |
| `SITEMAP_FILENAME` | `sitemap.xml` | Sitemap filename for per-podcast/static sitemaps |
| `SITEMAP_INDEX_FILENAME` | `index.xml` | Sitemap index filename (root sitemap) |
| **Upload limits (MB)** | | |
| `EPISODE_AUDIO_UPLOAD_MAX_MB` | `500` | Max episode source audio upload size |
| `SEGMENT_UPLOAD_MAX_MB` | `100` | Max recorded segment upload size |
| `LIBRARY_UPLOAD_MAX_MB` | `50` | Max library asset upload size |
| `MULTIPART_MAX_MB` | `500` | Max multipart body size for Fastify |
| `ARTWORK_MAX_MB` | `5` | Max podcast/episode artwork upload size |
| **Binaries** | | |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg binary |
| `FFPROBE_PATH` | `ffprobe` | Path to ffprobe binary |
| `AUDIOWAVEFORM_PATH` | `audiowaveform` | Path to audiowaveform binary |
| `ALLOW_VIDEO_GENERATION` | (false) | Set to `1` or `true` to enable episode video generation (requires node-canvas). When false, dev server runs without canvas. |
| `GEOIPUPDATE_PATH` | `geoipupdate` | Path to geoipupdate binary (MaxMind GeoIP) |
| `SMBCLIENT_PATH` | `smbclient` | Path to smbclient binary (SMB export) |
| **GeoIP** | | |
| `GEOIP_CONF_FILENAME` | `GeoIP.conf` | GeoIP config filename for geoipupdate |
| `GEOIP_EDITION_IDS` | `GeoLite2-Country GeoLite2-City` | GeoIP edition IDs (space-separated) |
| **Audio** | | |
| `WAVEFORM_EXTENSION` | `.waveform.json` | Extension for waveform JSON files |
| **Auth & users** | | |
| `PLATFORM_INVITES_PER_DAY` | `10` | Max "invite to platform" emails per inviter per 24 hours |
| `API_KEY_PREFIX` | `hfm_` | Prefix for API keys |
| `MAX_API_KEYS_PER_USER` | `5` | Max API keys per user |
| `FORGOT_PASSWORD_RATE_MINUTES` | `5` | Cooldown (minutes) between password-reset requests per email |
| `PROFILE_UPDATE_RATE_LIMIT_MINUTES` | `5` | Min interval (minutes) between email/username changes per user |
| `AUTH_2FA_CHALLENGE_EXPIRY_MINUTES` | `10` | 2FA challenge token validity (minutes) |
| `AUTH_CHALLENGE_TOKEN_BYTES` | `24` | 2FA challenge token size (bytes) |
| `JWT_SESSION_EXPIRY_DAYS` | `7` | JWT session expiry (days) |
| `VERIFICATION_TOKEN_BYTES` | `24` | Email verification token size (bytes) |
| `VERIFICATION_EXPIRY_HOURS` | `24` | Email verification link validity (hours) |
| `RESET_TOKEN_BYTES` | `32` | Password reset token size (bytes) |
| `RESET_TOKEN_EXPIRY_HOURS` | `1` | Password-reset and set-password link validity (hours) |
| **Login protection** | | |
| `LOGIN_FAILURE_THRESHOLD` | `3` | Ban after this many failed login attempts in the window |
| `CALL_JOIN_FAILURE_THRESHOLD` | `6` | Ban after this many call-join failures in the window |
| `LOGIN_BAN_MINUTES` | `10` | Login ban duration (minutes) |
| `LOGIN_WINDOW_MINUTES` | `10` | Window (minutes) for counting login failures |
| **Setup & bootstrap** | | |
| `SETUP_ID` | (none) | Pre-set setup token for `/setup?id=...` (deterministic URL) |
| `ADMIN_EMAIL` | (none) | Bootstrap admin email (with hash/password, creates admin on first boot) |
| `ADMIN_PASSWORD_HASH` | (none) | Bootstrap admin argon2 hash |
| `ADMIN_PASSWORD_HASH_FILE` | (none) | Path to file containing hash (avoids storing in .env) |
| `ADMIN_REGISTRATION_ENABLED` | (none) | When bootstrapping: `1` = allow registration |
| `ADMIN_PUBLIC_FEEDS_ENABLED` | (none) | When bootstrapping: `1` = public RSS enabled |
| `ADMIN_HOSTNAME` | (none) | Bootstrap: public base URL (e.g. `https://podcasts.example.com`) |
| **Rate limits** | | |
| `RATE_LIMIT_MAX` | `200` | Global rate limit: max requests per time window |
| `RATE_LIMIT_TIME_WINDOW` | `1 minute` | Global rate limit time window |
| `REGISTRATION_RATE_LIMIT_MAX` | `5` | Max registration requests per IP per minute. Set higher (e.g. 100) for e2e tests. |
| `RENDER_RATE_LIMIT_WINDOW_MS` | `60000` | Min ms between "Make Final Episode" requests per user. Set to `0` to disable (e.g. for e2e tests). |
| **Podcast stats** | | |
| `STATS_FLUSH_INTERVAL_MS` | `60000` | Podcast stats flush interval (ms) |
| `LISTEN_THRESHOLD_BYTES` | `256000` | Min bytes requested in one range to count as a listen (250 KB) |
| **Swagger** | | |
| `SWAGGER_UI_ROUTE_PREFIX` | (from API_PREFIX) | Swagger UI route (e.g. `/api/docs`) |
| `SWAGGER_UI_THEME_CSS_FILENAME` | (from APP_NAME) | Swagger UI theme CSS filename |
| `SWAGGER_ENABLED` | (true outside production) | Set to `true` to serve Swagger UI in production |
| **OpenAI** | | |
| `OPENAI_CHAT_COMPLETIONS_URL` | `https://api.openai.com/v1/chat/completions` | OpenAI chat completions API URL |
| `OPENAI_MODELS_URL` | `https://api.openai.com/v1/models` | OpenAI models API URL (e.g. for testing API key) |
| `TRANSCRIPTION_FETCH_TIMEOUT_MS` | `900000` | Whisper/OpenAI transcription HTTP timeout (ms); default 15 minutes |
| **SendGrid** | | |
| `SENDGRID_SCOPES_URL` | `https://api.sendgrid.com/v3/scopes` | SendGrid scopes API URL (e.g. for testing API key) |
| `SENDGRID_MAIL_SEND_URL` | `https://api.sendgrid.com/v3/mail/send` | SendGrid mail send API URL |
| **CAPTCHA** | | |
| `RECAPTCHA_VERIFY_URL` | `https://www.google.com/recaptcha/api/siteverify` | reCAPTCHA siteverify API URL |
| `HCAPTCHA_VERIFY_URL` | `https://hcaptcha.com/siteverify` | hCaptcha siteverify API URL |
| **FTP** | | |
| `FTP_CLIENT_TIMEOUT_MS` | `60000` | FTP client timeout (ms) |
| **Import** | | |
| `IMPORT_USER_AGENT` | `${APP_NAME}-Import/1.0` | User-Agent for podcast import HTTP requests |
| `IMPORT_FETCH_TIMEOUT_MS` | `60000` | Import HTTP timeout (ms) |
| `IMPORT_ALLOW_PRIVATE_URLS` | (false) | Set to `true` or `1` to allow podcast import from private/internal URLs (localhost, 10.x, 192.168.x, etc). Dev/testing only; disables SSRF protection. |
| **Subscriber tokens** | | |
| `SUBSCRIBER_TOKEN_PREFIX` | `hfm_sub_` | Prefix for subscriber RSS tokens in URL path |
| **DNS secrets** | | |
| `DNS_SECRETS_AAD` | `${APP_NAME}-dns` | AAD for encrypted DNS-related secrets (e.g. Cloudflare) |
| **Roles** | | |
| `ROLE_MIN_EDIT_SEGMENTS` | `editor` | Minimum share role to edit segments (`view`, `editor`, `manager`, `owner`) |
| `ROLE_MIN_EDIT_METADATA` | `manager` | Minimum share role to edit episode/podcast metadata |
| `ROLE_MIN_MANAGE_COLLABORATORS` | `manager` | Minimum share role to manage collaborators |

## Running without Docker

The server serves both the API and the static web app; no separate web server is required for production.

### Deploy with PM2

From the repo root, run the deploy script. It installs dependencies (`pnpm install --frozen-lockfile`), builds the project, then starts or reloads the app under PM2 using `ecosystem.config.cjs`:

```bash
pnpm run deploy:pm2
```

Requires **pnpm**, **pm2**, and **Node ≥ 22**. Configure the app via `server/.env` (see [Docker environment variables](#docker-environment-variables) for the full list). PM2 5.2+ will load it from the ecosystem config. Logs go to `logs/harborfm-out.log` and `logs/harborfm-err.log`. When self-hosting, API docs (Swagger) are at `https://<your-host>/api/docs`; API keys are in **Profile to API keys**.

### Manual build and run

1. **Build:** From the repo root, run `pnpm run build` (builds shared, server, and web).

2. **Run:** From the repo root, run `node server/dist/app.js`. Set `DATA_DIR`, `SECRETS_DIR`, and `JWT_SECRET` via env or `server/.env`.

3. **Process manager:** Use the included PM2 config (`ecosystem.config.cjs`) or run under systemd/another manager. Example without the deploy script:

```bash
cd /path/to/harborfm
pnpm run build
pm2 start ecosystem.config.cjs --only harborfm
```

## Features

- **Podcasts and episodes.** Create podcasts with metadata (artwork, categories, explicit, etc.). Add episodes with title, description, season/episode numbers, and status (draft, scheduled, published).

- **Segments.** Each episode is a sequence of segments. A segment is either recorded (audio uploaded for that episode) or reusable (from your library). Reorder, trim, split, and remove silence. The app uses ffmpeg to concatenate segments into the final episode audio.

- **Group calls.** Record remote guests via WebRTC; host starts a call, guests join by link or 4-digit code; in-call chat, soundboard, and settings; recordings become segments. Requires webrtc-service (see [WebRTC (group calls)](#webrtc-group-calls)).

- **Real-time collaboration.** Episode editor WebSocket; collaborators see live segment, call, and render updates.

- **Library.** Upload reusable audio (intros, outros, bumpers, ads). Tag them and insert them into any episode as segments.

- **Transcripts.** For recorded segments you can generate transcripts (via a configurable Whisper ASR URL), edit text, and use SRT-style timings. Optional LLM integration (Ollama or OpenAI) lets you ask questions about a segment’s transcript (e.g. summarise or suggest copy).

- **RSS.** Each podcast has an RSS feed. The app can serve it from the same host or you can deploy it elsewhere via S3 export.

- **Export to S3.** Configure an S3-compatible export per podcast (e.g. AWS S3, Cloudflare R2). Deploy feed and episode audio to a bucket; only changed files are uploaded (ETag comparison). Optional public base URL so the feed and enclosures use your CDN URL.

- **Auth and users.** First-user setup, registration, login, password reset. Optional admin role and user management. Public podcast and episode pages for listeners when public feeds are enabled.

## Embed

When public feeds are enabled, you can embed a single episode player on another site using an iframe.

**Embed URLs:**

- **Main host:** `https://your-harborfm.example/embed/{podcast-slug}/{episode-slug}`
- **Custom domain (linking hostname):** If your podcast uses a custom domain (e.g. `podcast.example.com`), use one segment: `https://podcast.example.com/embed/{episode-slug}`

If a user opens the embed URL directly in the browser (not in an iframe), they are redirected to the full episode page.

**Optional: resize iframe to content (e.g. for mobile)**  
The embed page sends its content height to the parent window so you can avoid a fixed iframe height and double scrollbars. Listen for `message` events and set the iframe height:

```javascript
window.addEventListener('message', function (e) {
  if (e.data?.type === 'harborfm-embed-height' && typeof e.data.height === 'number') {
    document.getElementById('your-embed-iframe').style.height = e.data.height + 'px';
  }
});
```

Check `e.origin` against your HarborFM origin in production if you want to restrict which origins can resize the iframe.

## Tech stack

- **Monorepo:** pnpm workspaces with four packages:
  - **shared** – Zod schemas and shared types
  - **server** – Fastify API, SQLite (better-sqlite3), ffmpeg for audio
  - **web** – React, Vite, TanStack Query
  - **webrtc-service** – mediasoup for group calls (optional)

- **Server:** Single Node process serves the API and the built web app (static files from `PUBLIC_DIR`). SQLite for persistence; no separate database server.

- **Audio:** ffmpeg and ffprobe for segment processing (trim, concat, silence removal, etc.). The Docker image includes ffmpeg.

- **Group calls:** Optional webrtc-service (mediasoup) for WebRTC; host and guests join a room, record to segments.

## Project structure

```
harborfm/
├── server/           # API and app entry
├── web/              # React frontend
├── webrtc-service/   # WebRTC/mediasoup for group calls
├── shared/           # Shared schemas and types
├── Dockerfile        # Multi-stage build, Node + ffmpeg
├── package.json      # Root scripts and workspace config
└── pnpm-workspace.yaml
```

## Scripts

From the repo root:

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Run API and web dev servers (concurrent) |
| `pnpm run dev:server` | Run only the API (tsx watch) |
| `pnpm run dev:web` | Run only the web dev server (Vite) |
| `pnpm run build` | Build shared, then server, then web |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm --filter server run db:seedSetup` | Automated initial setup from env (ADMIN_EMAIL, ADMIN_PASSWORD, etc.) |
| `pnpm run deploy:pm2` | Deploy to PM2 (install, build, start/reload); see [Deploy with PM2](#deploy-with-pm2) |
| `pnpm run reset-password` | Reset the first user’s password (server) |
| `pnpm run db:clear-ip-bans` | Clear the IP ban and login-attempt tables (server) |
| `pnpm run lint` | Lint all packages |
| `pnpm run typecheck` | Type-check all packages |
| `pnpm run test` | Run tests in all packages |
| `pnpm run docker:build` | Build the Docker image (`docker build -t harborfm .`) |
| `pnpm run build:docs` | Build the GitHub pages |

## Permissions

Each podcast has an **owner** (the user who created it) and optional **collaborators** with a role. Access is role-based; admins have full access to all podcasts.

| Role | Allowed actions |
|------|------------------|
| **view** | List/read podcast and episodes, stream audio, view analytics. Read-only. |
| **editor** | Everything in view, plus: edit segments, record new sections, render/build the final episode. |
| **manager** | Everything in editor, plus: create/update episodes and episode artwork, edit show details, configure **Podcast Delivery** (exports), manage collaborators (invite, change role, remove). |
| **owner** | Full control. Only the owner can delete the podcast or transfer ownership. |

- **Collaborators** are managed per show in **Settings to Collaborators**. You invite by email and choose a role (view, editor, or manager). If the person isn’t on Harbor yet, the UI can send them an “invite to the platform” email (rate-limited).
- **Storage** for a show (recorded segments, episode source audio) counts against the **podcast owner’s** storage limit, not the collaborator’s. If the owner is at or near their limit, “Record new section” is disabled for everyone on that show.
- **New episode** is only available to **managers** and the **owner**; view and editor roles see it disabled.

## Export

Podcast delivery exports push your RSS feed and episode audio to a destination. Configure one or more exports per show in **Settings to Podcast Delivery**; credentials are stored encrypted. Deploy skips files that are unchanged (using MD5 sidecar files where the service doesn’t provide hashes).

Supported export types and example request bodies (for create/update):

### S3 (AWS)

```json
{
  "mode": "S3",
  "name": "My Podcast on AWS",
  "bucket": "my-podcast-bucket",
  "prefix": "podcast",
  "region": "us-east-1",
  "access_key_id": "AKIA...",
  "secret_access_key": "your-secret-key",
  "public_base_url": "https://my-podcast-bucket.s3.amazonaws.com"
}
```

### R2 (Cloudflare)

```json
{
  "mode": "S3",
  "name": "My Podcast on R2",
  "bucket": "my-podcast",
  "prefix": "",
  "region": "auto",
  "endpoint_url": "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
  "access_key_id": "your-r2-access-key",
  "secret_access_key": "your-r2-secret-key",
  "public_base_url": "https://pub-xxx.r2.dev"
}
```

### B2 (Backblaze)

```json
{
  "mode": "S3",
  "name": "My Podcast on B2",
  "bucket": "my-podcast-bucket",
  "prefix": "podcast",
  "region": "us-west-002",
  "endpoint_url": "https://s3.us-west-002.backblazeb2.com",
  "access_key_id": "your-key-id",
  "secret_access_key": "your-application-key",
  "public_base_url": "https://f003.backblazeb2.com/file/my-podcast-bucket"
}
```

### FTP

```json
{
  "mode": "FTP",
  "name": "My FTP Server",
  "host": "ftp.example.com",
  "port": 21,
  "username": "ftpuser",
  "password": "secret",
  "path": "/public/podcast",
  "secure": false,
  "public_base_url": "https://cdn.example.com/podcast"
}
```

### SFTP

```json
{
  "mode": "SFTP",
  "name": "My SFTP Server",
  "host": "sftp.example.com",
  "port": 22,
  "username": "deploy",
  "password": "secret",
  "path": "/var/www/podcast/",
  "public_base_url": "https://cdn.example.com/podcast"
}
```

Use `private_key` instead of `password` for key-based auth (PEM string).

### WebDAV

```json
{
  "mode": "WebDAV",
  "name": "My WebDAV",
  "url": "https://webdav.example.com/remote.php/dav/files/user/",
  "username": "user",
  "password": "secret",
  "path": "podcast/",
  "public_base_url": "https://cdn.example.com/podcast"
}
```

### IPFS

```json
{
  "mode": "IPFS",
  "name": "My IPFS Node",
  "api_url": "http://127.0.0.1:5001",
  "path": "podcast/",
  "gateway_url": "https://ipfs.io",
  "public_base_url": "https://my-gateway.example.com/ipfs"
}
```

Optional: `api_key`, `username`, and `password` for authenticated nodes (e.g. behind Caddy with API key or Basic auth).

### SMB

```json
{
  "mode": "SMB",
  "name": "My SMB Share",
  "host": "nas.example.com",
  "port": 445,
  "share": "podcast",
  "username": "deploy",
  "password": "secret",
  "domain": "",
  "path": "feed/",
  "public_base_url": "https://cdn.example.com/podcast"
}
```

`port` is optional (defaults to 445 when omitted). Set `domain` for Windows domain auth if needed.

## Local Testing

Use the setup below to try HarborFM’s email and deployment features locally without real servers.

### SMTP (email)

Run a local SMTP server and web UI with [smtp4dev](https://github.com/rnwood/smtp4dev):

```bash
docker run --rm -it -p 5000:80 -p 2525:25 -p 110:110 rnwood/smtp4dev
```

- **Web UI:** http://localhost:5000  
- **SMTP:** `localhost:2525` (no TLS)  
- **POP3:** `localhost:110`  

Configure HarborFM Settings to Email with host `localhost`, port `2525`, and any from address. Accepts any username/password.

### Deployment targets (FTP, SFTP, WebDAV, IPFS, SMB)

Save the **docker-compose.yml** block below in a directory (e.g. a test folder), create the data directories, then start the stack:

```bash
mkdir -p ftp ipfs sftp sftp-keys smb webdav
docker compose up -d
```

| Service | Host port(s) | Credentials | Data dir |
|--------|---------------|-------------|----------|
| **FTP** (vsftpd) | 9400 (control), 9401–9410 (passive) | `ftpuser` / `ftppass` | `./ftp` |
| **SFTP** (OpenSSH) | 9411 | `sftpuser` / `sftppass` | `./sftp` |
| **WebDAV** | 9412 | `davuser` / `davpass` | `./webdav` |
| **IPFS** (via Caddy proxy) | 9413 (API), 9414 (Gateway), 9415 (Swarm) | `ipfsuser` / `ipfspass` | `./ipfs` |
| **SMB** (Samba) | 9416 | `smbuser` / `smbpass`, share `share` | `./smb` |

**docker-compose.yml:**

```yaml
services:
  # FTP (vsftpd)
  ftp:
    image: fauria/vsftpd
    container_name: test-ftp
    restart: unless-stopped
    environment:
      FTP_USER: ftpuser
      FTP_PASS: ftppass
      PASV_ADDRESS: host.docker.internal
      PASV_MIN_PORT: 9401
      PASV_MAX_PORT: 9410
      FILE_OPEN_MODE: "0666"
      LOCAL_UMASK: "022"
    volumes:
      - ./ftp:/home/vsftpd
    ports:
      - "9400:21"
      - "9401-9410:9401-9410"

  # SFTP (OpenSSH)
  sftp:
    image: atmoz/sftp
    container_name: test-sftp
    restart: unless-stopped
    command: "sftpuser::1001:1001:upload"
    volumes:
      - ./sftp:/home/sftpuser/upload
      - ./sftp-keys:/home/sftpuser/.ssh/keys
    ports:
      - "9411:22"

  # WebDAV
  webdav:
    image: bytemark/webdav
    container_name: test-webdav
    restart: unless-stopped
    environment:
      AUTH_TYPE: Basic
      USERNAME: davuser
      PASSWORD: davpass
      LOCATION: /webdav
    volumes:
      - ./webdav:/var/lib/dav
    ports:
      - "9412:80"

  # IPFS (Kubo) - internal only; use ipfs-proxy for auth
  ipfs:
    image: ipfs/kubo:latest
    environment:
      IPFS_TELEMETRY: false
    container_name: test-ipfs
    restart: unless-stopped
    volumes:
      - ./ipfs:/data/ipfs
    expose:
      - "5001"
      - "8080"
      - "4001"
    networks:
      - ipfsnet

  # IPFS auth proxy (Caddy Basic Auth)
  ipfs-proxy:
    image: caddy:2
    container_name: test-ipfs-proxy
    restart: unless-stopped
    depends_on:
      - ipfs
    networks:
      - ipfsnet
    ports:
      - "9413:9413"
      - "9414:9414"
      - "9415:4001"
    volumes:
      - ./ipfs/Caddyfile:/etc/caddy/Caddyfile:ro

  # SMB (Samba) - share name: share. Some clients expect port 445; use host 445 or test from another container.
  smb:
    image: dperson/samba
    container_name: test-smb
    restart: unless-stopped
    command: >
      -p
      -u "smbuser;smbpass"
      -s "share;/share;yes;no;no;smbuser"
    volumes:
      - ./smb:/share
    ports:
      - "9416:445"

networks:
  ipfsnet:
    driver: bridge
```

**IPFS Caddyfile** - save as `ipfs/Caddyfile`. The hash below is bcrypt for `ipfspass`; replace with your own via `caddy hash-password` if needed.

```
:9413 {
  basicauth {
    ipfsuser $2a$14$P0O6.FVoZP3wJtO/MDDI3OEoiep8iTyrjyEF/vkmNCmGtOHFPVVGW
  }
  reverse_proxy ipfs:5001
}

:9414 {
  basicauth {
    ipfsuser $2a$14$P0O6.FVoZP3wJtO/MDDI3OEoiep8iTyrjyEF/vkmNCmGtOHFPVVGW
  }
  reverse_proxy ipfs:8080
}
```

## Troubleshooting

- **Setup URL / "Server not set up yet"** - On first run, the one-time setup URL is printed in the server (or container) logs. Open that URL in your browser (e.g. `https://your-host/setup?id=...`) to create the admin account. If you lost the URL, restart the server to see it again (the token is regenerated only if the secrets file is missing).
- **ffmpeg or audiowaveform not found** - Ensure they are installed and on your `PATH`. The Docker image includes ffmpeg; for local dev, install via your package manager or [audiowaveform](https://github.com/bbc/audiowaveform) from source.
- **Group calls not working** - See [WebRTC (group calls)](#webrtc-group-calls).

## Backup and upgrading

Before upgrading, back up **DATA_DIR** (SQLite database, uploads, processed audio, RSS files, artwork, library). Optionally back up **SECRETS_DIR** if you rely on the persisted JWT or secrets key files. Migrations run automatically on server start; no separate migration step is required for upgrades.

## Single Sign-On (SSO)

HarborFM supports Single Sign-On via **OIDC** (OpenID Connect) and **SAML**. Configured providers appear as sign-in options on the login page. Add and edit providers under **Settings to SSO (OIDC / SAML)**. Use the list to add a provider, then open it to set endpoints, client credentials, and optional attributes. Use `(set)` in password or certificate fields when editing to keep existing secrets without re-entering them.

The examples below assume your HarborFM instance is at **https://app.harborfm.com** and you are using **Keycloak** as the identity provider.

### Connecting OIDC (Keycloak)

1. **Keycloak realm and client**
   - In Keycloak Admin: create or select a realm (e.g. `harborfm`).
   - Create a client: **Clients to Create client**.
   - Client ID: e.g. `harborfm`.
   - Client authentication: **On**.
   - Valid redirect URIs: `https://app.harborfm.com/api/auth/sso/oidc/callback/harborfm` (use your provider ID in the path).
   - Save, then open the client **Credentials** tab and copy the **Client secret**.

2. **HarborFM Settings**
   - Go to **Settings to SSO (OIDC / SAML)** and ensure **Hostname** is set to `app.harborfm.com` (or `https://app.harborfm.com`).
   - Under **OIDC providers**, click **Add Provider**.
   - **Provider ID**: `harborfm` (must match the path segment in the callback URL).
   - **Display Name**: e.g. `Keycloak` or your org name.
   - **Discovery URL**: your Keycloak OpenID configuration URL, e.g. `https://keycloak.example.com/realms/harborfm` (no path suffix; HarborFM fetches `/.well-known/openid-configuration`).
   - **Client ID**: same as in Keycloak (e.g. `harborfm`).
   - **Client Secret**: paste the Keycloak client secret.
   - **Scopes**: default `openid profile email` is usually sufficient.
   - Leave **Trust email from provider** enabled if you want account linking by email.
   - Save the provider, then click **Save** at the bottom of the Settings page.

3. **Verify**
   - Open the login page; you should see a sign-in option for your OIDC provider. Use it to sign in; the first time, an account may be created or linked by email.

If you see “issuer does not match”, set **Issuer Override** in the provider to the exact `issuer` value from Keycloak’s `/.well-known/openid-configuration` (e.g. `https://keycloak.example.com/realms/harborfm`).

### Connecting SAML (Keycloak)

SAML is a way for your app to send users to Keycloak to log in; Keycloak then sends them back to your app with proof they authenticated. You register HarborFM as a "client" in Keycloak and tell HarborFM how to talk to Keycloak. The two sides must agree on a few exact strings (an identifier and a callback URL).

**Pick a Provider ID** (e.g. `keycloak`) and use it in the callback URL. HarborFM’s SAML entity ID is always your app base URL + `/api/auth/sso/saml`; set that as **Client ID** in Keycloak.

Replace `keycloak.example.com` and `harborfm` below with your Keycloak host and realm name.

---

#### Step 1: Create the SAML client in Keycloak

1. Log into the Keycloak Admin Console and select your realm (e.g. **harborfm**).
2. In the left sidebar, click **Clients**.
3. Click **Create client**.
4. **General settings** (first page):
   - **Client type**: choose **SAML**.
   - **Client ID**: enter HarborFM’s SAML entity ID, which is your app base URL + `/api/auth/sso/saml`, e.g. `https://app.harborfm.com/api/auth/sso/saml`. Keycloak matches this to the issuer HarborFM sends in the SAML request.
   - **Name**: optional; e.g. `HarborFM`.
5. Click **Next** (or **Save**). You'll land on the client **Settings** tab.

6. On the **Settings** tab, under **Access settings**:
   - **Root URL**: `https://app.harborfm.com` (your HarborFM base URL).
   - **Valid redirect URIs**: click **Add** and enter your callback URL exactly:
     ```
     https://app.harborfm.com/api/auth/sso/saml/callback/keycloak
     ```
     (If you used a different Provider ID, replace `keycloak` in that URL with your Provider ID.) This is where Keycloak is allowed to send the user after login (the "callback" or ACS URL). HarborFM sends this URL in the SAML request; Keycloak checks it against Valid redirect URIs.
   - If your Keycloak version shows **Master SAML Processing URL** in the same section, set it to the same callback URL. If you don't see that field, **Valid redirect URIs** is enough.
7. On the **Keys** tab (only needed if "Want AuthnRequests signed" is ON for this client):
   - Keycloak needs your **SP public certificate** so it can verify signed requests from HarborFM.
   - If you don't have a key pair yet, generate one on your machine:
     - `openssl genrsa -out sp-key.pem 2048`
     - `openssl req -x509 -new -key sp-key.pem -out sp-cert.pem -days 3650 -subj "/CN=harbor-sp"`
   - Inside HarborFM (Step 3) you will paste the contents of **sp-key.pem** (private key) into **SP private key (PEM)**.
   - Here in Keycloak, import only the **certificate** (**sp-cert.pem**): choose **Certificate (PEM)** if available and upload the sp-cert.pem or paste the contents of sp-cert.pem (including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`).
8. Click **Save**.

---

#### Step 2: Get Keycloak's IdP certificate and SSO URL

HarborFM needs Keycloak's public certificate to verify SAML responses, and the URL where users are sent to log in.

1. **IdP certificate (PEM)**  
   - In the left sidebar, open **Realm settings** (for your realm), then open the **Keys** tab.  
   - Find the **RS256** key with **SIG** (signing) in the **Use** column.  
   - Open **Certificate** and copy the certificate (PEM form, including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`). You'll paste it into HarborFM in Step 3.

2. **IdP Entry Point URL (where users log in)**  
   This is your realm's SAML endpoint. It has the form:
   ```
   https://keycloak.example.com/realms/harborfm/protocol/saml
   ```
   Replace the host with your Keycloak URL and `harborfm` with your realm name. You'll paste this into HarborFM as **IdP Entry Point URL**.

---

#### Step 3: Add the SAML provider in HarborFM

1. In HarborFM, go to **Settings** and find **SSO (OIDC / SAML)**.
2. Under **SAML providers**, click **Add Provider** and fill in the popup:
   - **Provider ID**: the slug you use in the callback URL (e.g. `keycloak`). The form shows the **Callback URL (ACS URL)** read-only - copy that into Keycloak’s Valid redirect URIs.
   - **Display Name**: e.g. `Keycloak` (shown on the login page).
   - **IdP Entry Point URL**: the Keycloak SAML URL from Step 2 (e.g. `https://keycloak.example.com/realms/harborfm/protocol/saml`).
   - **IdP certificate (PEM)**: paste the PEM from Step 2 above (the IdP’s certificate). HarborFM uses it to verify SAML responses from Keycloak.
   - **SP certificate (PEM)** (optional): leave blank unless your IdP requires the client to sign SAML requests. In Keycloak, that’s **Clients** to your SAML client to **Settings** to **Client Signature Required** = ON. If you enable it: generate a key pair for HarborFM (the SP), paste the **SP private key** (PEM, e.g. `-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----`) into this field, and add the matching **public certificate** to Keycloak’s client **Keys** tab so Keycloak can verify the signature. Most setups leave **Client Signature Required** OFF and leave this blank.
   HarborFM derives the entity ID and callback URL from Hostname and Provider ID. Use the **Callback URL** shown in the form when configuring Keycloak; set **Client ID** in Keycloak to your base URL + `/api/auth/sso/saml` (e.g. `https://app.harborfm.com/api/auth/sso/saml`).
3. Save the provider, then click **Save** at the bottom of the Settings page.

---

#### Step 4: Test it

Open HarborFM's login page. You should see an option to sign in with your SAML provider (e.g. "Keycloak"). Click it; you should be sent to Keycloak to log in and then back to HarborFM, logged in.

**If it doesn't work:** Double-check that **Client ID** in Keycloak is exactly your HarborFM base URL + `/api/auth/sso/saml` (e.g. `https://app.harborfm.com/api/auth/sso/saml`), and that the callback URL in both places is exactly the same.

## Instance manager (beta)

The **instance manager** is a web UI to list and deploy HarborFM instances using [Terraform](infrastructure/terraform/README.md) (AWS or Vultr). Deploys stream live `terraform` output. Kubernetes/Helm support is in progress.

**Run with Docker (recommended)**

**Example `.env`**

```env
# Required for Vultr deploys
VULTR_API_KEY=your-vultr-api-key

# Required for AWS deploys: set both below, or mount your AWS config in docker run with -v ~/.aws:/home/node/.aws:ro instead
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key

## Encrypts the config and data json.
# MANAGER_SECRET=$(openssl rand -base64 32)

# Optional: port (default 3999), FlareVault (sends encrypted username/password to instance)
# PORT=3999
# FLAREVAULT_URL=https://...
# FLAREVAULT_ADMIN_TOKEN=...
```

```bash
cd infrastructure/instance-manager
# Ensure config.json and data.json exist: echo '{}' > config.json && echo '{}' > data.json
# For AWS deploys you can use -v ~/.aws:/home/node/.aws:ro instead of AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in .env
docker run -d \
  --env-file .env \
  -p 3997:3999 \
  -v "$(pwd)/tfstate:/data" \
  -v "$(pwd)/config.json:/app/manager/config.json" \
  -v "$(pwd)/data.json:/app/manager/data.json" \
  ghcr.io/loganrickert/harborfm-instance-manager:latest
```

Open http://localhost:3997. Config, instance data, and Terraform state persist in the current directory via the bind mounts.

**Run locally (dev)** - From the repo root: `pnpm run dev:manager`, then open http://localhost:3998. Terraform still needs credentials in `infrastructure/terraform/vultr/.env` or `infrastructure/terraform/aws/.env` (or in the manager `.env`).

Full setup, all env options, and building the image yourself: [infrastructure/instance-manager/README.md](infrastructure/instance-manager/README.md).

### FlareVault

[FlareVault](https://github.com/LoganRickert/FlareVault) is a separate project: single-use secret delivery on Cloudflare Workers (Durable Objects + sealed ECDH delivery). HarborFM’s Terraform and instance manager can use it to send admin credentials to new instances at boot instead of putting them in user-data. Deploy your own worker, then set `FLAREVAULT_URL` and `FLAREVAULT_ADMIN_TOKEN` in your Terraform or instance-manager `.env`. See [infrastructure/instance-manager/FlareVault.md](infrastructure/instance-manager/FlareVault.md) for HarborFM-specific setup and the [FlareVault repo](https://github.com/LoganRickert/FlareVault) for the API and deployment.

## License

MIT. See [LICENSE](LICENSE).
