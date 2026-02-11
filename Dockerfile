# Build stage: install deps, build shared + server + web
FROM node:22-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY server ./server
COPY web ./web
COPY scripts ./scripts

RUN pnpm run lint
RUN pnpm run db:migrate:test
RUN pnpm run build

# Runtime stage: Node + ffmpeg, single image
FROM node:22-bookworm-slim

ARG TARGETARCH

# enable contrib (needed for geoipupdate on bookworm)
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/debian.sources; \
  else \
    sed -i 's/ main$/ main contrib/' /etc/apt/sources.list; \
  fi

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg tini build-essential python3 ca-certificates wget libmad0 \
    libid3tag0 libboost-program-options1.74.0 geoipupdate smbclient \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  if [ "$TARGETARCH" = "amd64" ]; then \
    DEB_ARCH="amd64"; \
  elif [ "$TARGETARCH" = "arm64" ]; then \
    DEB_ARCH="arm64"; \
  else \
    echo "Unsupported arch: $TARGETARCH"; exit 1; \
  fi; \
  wget -O /tmp/audiowaveform.deb \
    https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform_1.10.2-1-12_${DEB_ARCH}.deb; \
  dpkg -i /tmp/audiowaveform.deb || apt-get update && apt-get -f install -y; \
  rm -f /tmp/audiowaveform.deb

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

# Copy workspace and built artifacts so pnpm can link @harborfm/shared
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/web/package.json ./web/

RUN mkdir -p /data /secrets \
  && useradd -m -u 10001 appuser \
  && chown -R appuser:appuser /app /data /secrets

USER appuser

RUN pnpm install --frozen-lockfile --prod && pnpm rebuild

COPY --chown=appuser:appuser --from=builder /app/server/dist ./server/dist
COPY --chown=appuser:appuser --from=builder /app/server/initial-assets.json ./server/
COPY --chown=appuser:appuser --from=builder /app/web/dist ./server/public

# Server runs from /app/server, serves web from server/public
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3001
# Persist app data (DB, uploads, processed audio, rss, artwork, library)
ENV DATA_DIR=/data
# Persist secrets (jwt-secret.txt, secrets-key.txt) — mount separately for stricter access
ENV SECRETS_DIR=/secrets
ENV PUBLIC_DIR=/app/server/public

VOLUME ["/data", "/secrets"]

EXPOSE 3001

ENTRYPOINT ["tini", "--"]
# Default: run server (single process serves API + static web app)
CMD ["node", "dist/app.js"]
