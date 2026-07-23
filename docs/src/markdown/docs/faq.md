# FAQ

## Is HarborFM Free / Open Source?

Yes. HarborFM is open source under the MIT License. You can self-host it or try the [public demo](https://app.harborfm.com/).

## Where Should My Data Live?

HarborFM needs a writable **data** directory (SQLite DB, uploads, processed audio, RSS, artwork, library, page themes) and optionally a **secrets** directory (JWT and encryption key files). In Docker these are often `/data` and `/secrets`. You can pass secrets via environment variables instead of mounting `/secrets`.

## Why Are My Cookies / Login Failing on HTTP?

In production, cookies default to **Secure**. On plain HTTP set `COOKIE_SECURE=false`. Prefer HTTPS via Caddy or nginx (see [Docker Compose](/docs/installation/docker-compose/)).

## Where Is the API Documentation?

Interactive OpenAPI / Swagger UI is on this site at [API (Swagger)](/server/). On a self-hosted instance it is also available at `/api/docs` when Swagger is enabled.

## Where Do I Learn About Page Themes?

See [Themes](/themes/) for gallery and import, and the [Theme Authoring Guide](/theme-guide/) for building Liquid theme packages. Usage details are also in [Page themes](/docs/usage/page-themes/).

## Docker vs Compose vs Terraform?

- **Docker** - single container for a quick try or simple host.
- **Docker Compose / install.sh** - app plus reverse proxy, optional WebRTC, Let's Encrypt.
- **Terraform** - provision an AWS or Vultr VM that boots HarborFM via user-data.

See [Installation](/docs/installation/docker/) for each path.

## Where Is the Full Environment Variable List?

The curated [Environment Variables](/docs/installation/environment-variables/) page covers essentials. The complete table lives in the [README](https://github.com/LoganRickert/harborfm/blob/main/README.md#docker-environment-variables).

## How Do I Update an Install.sh Deploy?

From the install directory, run `update.sh`. It refreshes compose configs and images with brief downtime on recreate. Always run `docker compose` from the install directory so paths in `.env` resolve correctly.
