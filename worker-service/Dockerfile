# Build from repo root: docker build -f worker-service/Dockerfile .
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json ./shared/
COPY video-gen/package.json ./video-gen/
COPY worker-service/package.json ./worker-service/

RUN pnpm install --frozen-lockfile --filter worker-service...

COPY shared ./shared
COPY video-gen ./video-gen
COPY worker-service ./worker-service

RUN pnpm --filter shared run build \
  && pnpm --filter @harborfm/video-gen run build \
  && pnpm --filter worker-service run build

FROM node:22-bookworm-slim

ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates wget \
    libmad0 libid3tag0 libboost-program-options1.74.0 \
    libcairo2 libpango-1.0-0 libjpeg62-turbo libgif7 \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev \
    build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  if [ "$TARGETARCH" = "amd64" ]; then DEB_ARCH="amd64"; \
  elif [ "$TARGETARCH" = "arm64" ]; then DEB_ARCH="arm64"; \
  else echo "Unsupported arch: $TARGETARCH"; exit 1; fi; \
  wget -O /tmp/audiowaveform.deb \
    https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform_1.10.2-1-12_${DEB_ARCH}.deb; \
  dpkg -i /tmp/audiowaveform.deb || (apt-get update && apt-get -f install -y); \
  rm -f /tmp/audiowaveform.deb

RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/video-gen/package.json ./video-gen/
COPY --from=builder /app/video-gen/dist ./video-gen/dist
COPY --from=builder /app/worker-service/package.json ./worker-service/

RUN useradd -m -u 10001 appuser \
  && mkdir -p /work \
  && chown -R appuser:appuser /app /work

USER appuser

RUN pnpm install --frozen-lockfile --prod --filter worker-service... \
  && pnpm rebuild \
  && (COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm -C node_modules/.pnpm/canvas@3.2.1/node_modules/canvas run install 2>/dev/null || true)

COPY --chown=appuser:appuser --from=builder /app/worker-service/dist ./worker-service/dist

WORKDIR /app/worker-service
ENV NODE_ENV=production
ENV WORKER_WORK_DIR=/work

CMD ["node", "dist/index.js"]
