# HarborFM compute worker

Connects to your HarborFM server over a secret WebSocket path and runs heavy jobs (episode video generation and self-hosted Whisper transcription) on this machine.

## Setup

1. In HarborFM **Settings > Workers**, enable workers and copy the WebSocket path (or Worker connection URL) and shared secret.
2. Copy `.env.example` to `.env` and fill `HARBORFM_URL`, `WORKER_WS_PATH`, `WORKER_SECRET`.
   `WORKER_WS_PATH` accepts the path token or the full connection URL.
   Use a unique `WORKER_NAME` per machine so brief reconnects can resume the same job.
3. Run:

```bash
docker compose --env-file .env up -d
```

If Whisper already runs elsewhere, copy `docker-compose.override.yml.example` to `docker-compose.override.yml` (gitignored; auto-merged) and set `WHISPER_ASR_URL` (e.g. `http://host.docker.internal:9000`).

Or pull `ghcr.io/<owner>/harborfm-worker` and use the same compose file.

## Large files / reverse proxy

Worker **uploads** are split into chunks (`WORKER_UPLOAD_CHUNK_MB`, default **50**) so reverse proxies do not need multi-GB body limits. Set nginx `client_max_body_size` above that chunk size (e.g. `64m` for the default) and raise proxy timeouts for worker file routes:

- `client_max_body_size 64m;` (or higher)
- `proxy_read_timeout` / `proxy_send_timeout` of 3600s or more
- `proxy_request_buffering off;` for PUT uploads

## Dev

```bash
pnpm --filter worker-service install
HARBORFM_URL=http://localhost:3001 WORKER_WS_PATH=... WORKER_SECRET=... pnpm --filter worker-service dev
```

Whisper must be reachable at `WHISPER_ASR_URL`. Default compose starts a local Whisper container; use a local `docker-compose.override.yml` to skip it.
