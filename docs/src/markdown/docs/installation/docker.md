# Docker

Run HarborFM as a single container. The image includes Node, ffmpeg, and the built app; the server serves the API and the static web UI.

## Quick Start (Prebuilt Image)

```bash
HARBORFM_SECRETS_KEY=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)

docker run --name harborfm -p 3001:3001 \
  -v harborfm-data:/data \
  -e HARBORFM_SECRETS_KEY="$HARBORFM_SECRETS_KEY" \
  -e JWT_SECRET="$JWT_SECRET" \
  ghcr.io/loganrickert/harborfm:latest
```

Open `http://localhost:3001` (or your host and port). Migrations run on first start. The one-time setup URL is printed in the container logs (`docker logs harborfm`).

## Volumes and Secrets

- Mount a writable volume at `/data` for the database, uploads, audio, RSS, artwork, library, and page themes.
- You can omit a `/secrets` mount if you pass `JWT_SECRET` and optional `HARBORFM_SECRETS_KEY` via `-e`.
- For **http**, set `COOKIE_SECURE=false`. Prefer a reverse proxy with HTTPS in production.

## Build from Source

From the repo root:

```bash
docker build -t harborfm .
# or
pnpm run docker:build
```

Then run with your tag instead of `ghcr.io/loganrickert/harborfm:latest`.

## See Also

- [Docker Compose](/docs/installation/docker-compose/) for HTTPS and optional WebRTC
- [Environment Variables](/docs/installation/environment-variables/)
- [Getting Started](/docs/getting-started/)
