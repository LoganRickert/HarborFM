# Build from repo root: docker build -f webrtc-service/Dockerfile .
# Use Debian-based image; mediasoup prebuilt worker does not support Alpine (musl).
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY webrtc-service/package.json ./
RUN npm install
COPY webrtc-service/tsconfig.json ./
COPY webrtc-service/src ./src
RUN npx tsc

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY webrtc-service/package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3002
EXPOSE 40000-40100/udp
CMD ["node", "dist/index.js"]
