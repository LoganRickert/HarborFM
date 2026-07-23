# Getting Started

The quickest way to try HarborFM is a single Docker container. For a full stack with HTTPS, use the Compose installer.

## Docker One-Liner

```bash
HARBORFM_SECRETS_KEY=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)

docker run --name harborfm -p 3001:3001 \
  -v harborfm-data:/data \
  -e HARBORFM_SECRETS_KEY="$HARBORFM_SECRETS_KEY" \
  -e JWT_SECRET="$JWT_SECRET" \
  ghcr.io/loganrickert/harborfm:latest
```

Open `http://localhost:3001`. Get the one-time setup URL from `docker logs harborfm`, create the admin account, then sign in.

If you use plain **http**, set `COOKIE_SECURE=false`. Behind HTTPS, leave Secure cookies enabled (the production default).

## Full Stack (Compose)

```bash
curl -fsSL https://raw.githubusercontent.com/loganrickert/harborfm/main/install.sh | bash
```

Follow the prompts for domain and reverse proxy (Caddy by default; nginx optional). See [Docker Compose](/docs/installation/docker-compose/) for profiles, WebRTC, and updates.

## Next Steps

1. Complete the one-time setup URL and create your admin account.
2. Follow [Usage: Getting started](/docs/usage/getting-started/) for your first show and episode.
3. Browse [Installation](/docs/installation/docker/) for Terraform, manual installs, and environment variables.
4. Skim the [FAQ](/docs/faq/) for common self-hosting questions.
