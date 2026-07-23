# Manual Setup

Run HarborFM without Docker when you prefer a native Node deploy (for example under PM2).

## Requirements

- **Node.js** 22 or newer
- **pnpm** (workspaces; npm/yarn are not supported for install)
- **ffmpeg** and **audiowaveform**
- For episode video waveforms, system libs for **node-canvas** (see the [README](https://github.com/LoganRickert/harborfm/blob/main/README.md#requirements))

## Local Development

```bash
git clone https://github.com/LoganRickert/harborfm.git
cd harborfm
pnpm install
pnpm run db:migrate
pnpm run dev
```

Open the URL shown (for example `http://localhost:5173`). On first run, get the one-time setup URL from the server logs, create the admin account, then sign in.

Optional: copy `server/.env.example` to `server/.env` and set `DATA_DIR`, `SECRETS_DIR`, `JWT_SECRET`, and related overrides.

## Production Build

1. From the repo root: `pnpm run build` (builds shared, server, and web).
2. Run: `node server/dist/app.js` with `DATA_DIR`, `SECRETS_DIR`, and `JWT_SECRET` set via env or `server/.env`.
3. Process manager: use the included PM2 config or another supervisor.

### Deploy with PM2

```bash
pnpm run deploy:pm2
```

This installs dependencies (`pnpm install --frozen-lockfile`), builds, then starts or reloads the app under PM2 using `ecosystem.config.cjs`. Logs go to `logs/harborfm-out.log` and `logs/harborfm-err.log`.

When self-hosting, API docs (Swagger) are at `https://<your-host>/api/docs` when enabled; API keys live under **Profile → API keys**.

## See Also

- [Environment Variables](/docs/installation/environment-variables/)
- [Contributing](/docs/contributing/) for development workflow
- [Docker](/docs/installation/docker/) if you prefer containers
