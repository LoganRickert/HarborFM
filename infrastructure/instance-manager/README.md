# HarborFM Instance Manager

Web UI to list and deploy multiple HarborFM instances. Supports **Terraform** (AWS or Vultr) and **Kubernetes** (Helm). Terraform and Helm configs live in `infrastructure/terraform` and `infrastructure/helm`; this app invokes them and streams live output on deploy.

Notes: Kubernetes/Helm support is still a work in progress.

## Run alongside HarborFM dev

From the monorepo root:

```bash
pnpm run dev          # Terminal 1: main HarborFM server + web
pnpm run dev:manager  # Terminal 2: Instance Manager
```

Open **http://localhost:3998** (Vite dev server; it proxies `/api` to the manager on port 3999).

## Env

Copy `.env.example` to `.env` and set as needed:

- **PORT** – API server port (default `3999`).
- **INFRASTRUCTURE_ROOT** – Repo root path if you run from a different cwd.
- **KUBECONFIG** – For Helm/Kubernetes; optional.
- **VULTR_API_KEY** – Required for Terraform Vultr deploys. Set in `.env` or in `infrastructure/terraform/vultr/.env`.
- **AWS_ACCESS_KEY_ID** / **AWS_SECRET_ACCESS_KEY** – Required for Terraform AWS deploys. Set in `.env` or in `infrastructure/terraform/aws/.env`.
- **MANAGER_SECRET** – Optional; if unset, `run-docker.sh` generates one and appends it to `.env`. When set, `config.json` and `data.json` can be stored encrypted at rest.
- **FLAREVAULT_URL** / **FLAREVAULT_ADMIN_TOKEN** – Optional; for FlareVault-backed admin credentials on deploy.


## Features

- **Instances** – List Terraform workspaces (AWS + Vultr) and Helm releases. Filter by orchestrator and provider. Shows URL, IP, setup link where available.
- **Deploy** – Terraform or Kubernetes; for Terraform choose AWS or Vultr. Form covers name, domain, deploy type, WebRTC, admin/certbot, region/plan. Submit streams live `terraform` / `helm` output and shows success or error when done.
- **Settings** – Defaults for deploy form and optional SSH key.

## Build and run (production)

```bash
pnpm run build   # Vite build + tsc
pnpm run start   # Node server; serves API and static UI on PORT
```

Open http://localhost:3999 (or your PORT).

## Docker

The image includes the instance-manager app and Terraform (AWS + Vultr). Use the helper scripts from the instance-manager directory.

**Build** (from repo root):

From the repo root: `docker build -f infrastructure/instance-manager/Dockerfile -t instance-manager .`

**Run** (from `infrastructure/instance-manager`):

```bash
cd infrastructure/instance-manager
./run-docker.sh
```

- Requires a `.env` file (copy from `.env.example`). If `MANAGER_SECRET` is not set, the script generates one and appends it to `.env`.
- **Volumes**: `./tfstate` → `/data` (Terraform state); `./config.json` and `./data.json` → container (created as `{}` if missing). Config and instance data therefore persist in the current directory.
- **Port**: Container 3999 is published as **3997** (so it doesn’t clash with a local manager). Open http://localhost:3997.
- **Credentials**: Set `VULTR_API_KEY` (and for AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) in `.env` so deploys work. The API errors with a clear message if they’re missing.
- Ctrl+C stops the container (`--init` forwards signals).

## Layout

- `src/` – Fastify API, routes, Terraform/Helm runners.
- `frontend/` – Vite + React UI (dashboard, instance list, deploy form).
- `build-docker.sh` – Build image from repo root.
- `run-docker.sh` – Run container with `.env`, tfstate, and config/data bind-mounted from pwd.
