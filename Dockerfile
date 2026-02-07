# Build stage: install deps, build shared + server + web
FROM node:20-bookworm-slim AS builder

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

RUN pnpm run build

# Runtime stage: Node + ffmpeg, single image
FROM node:20-bookworm-slim

# Install ffmpeg for audio processing (segments, concat, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

# Copy workspace and built artifacts so pnpm can link @harborfm/shared
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/web/package.json ./web/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./server/public

RUN mkdir -p /data

RUN useradd -m -u 10001 appuser \
  && mkdir -p /data \
  && chown -R appuser:appuser /app /data

USER appuser

# Server runs from /app/server, serves web from server/public
WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3001
# Map this volume to persist DB, uploads, processed audio, rss, artwork, library
ENV DATA_DIR=/data
ENV PUBLIC_DIR=/app/server/public

EXPOSE 3001

ENTRYPOINT ["tini", "--"]
# Default: run server (single process serves API + static web app)
CMD ["node", "dist/app.js"]
