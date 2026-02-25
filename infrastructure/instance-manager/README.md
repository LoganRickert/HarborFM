# HarborFM Instance Manager

Web UI to list and deploy multiple HarborFM instances. Supports **Terraform** (AWS or Vultr) and **Kubernetes** (Helm). Terraform and Helm configs live in the existing `infrastructure/terraform` and `infrastructure/helm` directories; this app only invokes them.

Notes: Kubernetes has not been integrated correctly yet. This is still a work in progress.

## Run alongside HarborFM dev

From the monorepo root:

```bash
pnpm run dev          # Terminal 1: main HarborFM server + web
pnpm run dev:manager  # Terminal 2: Instance Manager
```

Then open **http://localhost:3998** (Vite dev server; it proxies `/api` to the manager API on port 3999).

## Env

Copy `.env.example` to `.env` and set if needed:

- **PORT** – API server port (default `3999`).
- **INFRASTRUCTURE_ROOT** – Repo root path if you run from a different cwd.
- **KUBECONFIG** – For Helm/Kubernetes; optional.

Terraform (AWS/Vultr) uses the existing `.env` files in `infrastructure/terraform/aws` and `infrastructure/terraform/vultr` when running `terraform` / `run.sh`.

## Features

- **Instances** – List Terraform workspaces (AWS + Vultr) and Helm releases. Filter by orchestrator and provider. Shows URL, IP, setup link where available.
- **Deploy** – Choose Terraform or Kubernetes, then AWS or Vultr (for Terraform). Fill name, domain, deploy type, WebRTC, admin/certbot options, and region/plan. Submit runs `terraform apply` or `helm upgrade --install` and shows output.

## Build and run (production)

```bash
pnpm run build   # Vite build + tsc
pnpm run start   # Node server; serves API and static UI on PORT
```

Open http://localhost:3999 (or your PORT).

## Layout

- `src/` – Fastify API server, routes, Terraform/Helm runners.
- `frontend/` – Vite + React UI (dashboard, instance list, deploy form).
