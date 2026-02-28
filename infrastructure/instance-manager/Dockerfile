# Build from repo root: docker build -f infrastructure/instance-manager/Dockerfile .
# Instance-manager app + Terraform (binary + code, no tfstate). State lives under /data; use -v ./tfstate:/data.

# ---- Build instance-manager (Node API + Vite/React frontend) ----
FROM node:22-bookworm-slim AS app-builder
WORKDIR /build
COPY infrastructure/instance-manager/package.json ./
RUN npm install
COPY infrastructure/instance-manager/tsconfig.json infrastructure/instance-manager/vite.config.ts ./
COPY infrastructure/instance-manager/src ./src
COPY infrastructure/instance-manager/frontend ./frontend
RUN npm run build

# ---- Runtime: Node + Terraform + run.sh deps ----
FROM node:22-bookworm-slim
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates jq openssl unzip \
  && rm -rf /var/lib/apt/lists/*

# Install Terraform (match arch for multi-platform build)
ENV TF_VERSION=1.9.0
RUN case "$TARGETARCH" in \
    "amd64") TF_ARCH=amd64 ;; \
    "arm64") TF_ARCH=arm64 ;; \
    *) echo "Unsupported arch: $TARGETARCH"; exit 1 ;; \
    esac \
  && curl -fsSL "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_${TF_ARCH}.zip" -o /tmp/terraform.zip \
  && unzip -o /tmp/terraform.zip -d /usr/local/bin \
  && rm /tmp/terraform.zip \
  && terraform -version

# /app = INFRASTRUCTURE_ROOT (terraform + server script for FlareVault hashing)
ENV INFRASTRUCTURE_ROOT=/app
WORKDIR /app

# Terraform config (exclude .terraform, tfstate, .env, terraform.tfvars via .dockerignore)
COPY infrastructure/terraform/common ./infrastructure/terraform/common
COPY infrastructure/terraform/modules ./infrastructure/terraform/modules
COPY infrastructure/terraform/aws ./infrastructure/terraform/aws
COPY infrastructure/terraform/vultr ./infrastructure/terraform/vultr
# user-data script referenced by terraform modules (file("${path.module}/../../../user-data/..."))
COPY infrastructure/user-data ./infrastructure/user-data

# Backend only in Docker: state under /data (not in repo)
RUN printf 'terraform {\n  backend "local" {\n    path          = "/data/aws/terraform.tfstate"\n    workspace_dir = "/data/aws/terraform.tfstate.d"\n  }\n}\n' > infrastructure/terraform/aws/backend.tf \
  && printf 'terraform {\n  backend "local" {\n    path          = "/data/vultr/terraform.tfstate"\n    workspace_dir = "/data/vultr/terraform.tfstate.d"\n  }\n}\n' > infrastructure/terraform/vultr/backend.tf

# Backend uses /data; create dirs so terraform init can run (state written at apply time)
RUN mkdir -p /data/aws /data/vultr
RUN cd infrastructure/terraform/aws && terraform init -input=false \
  && cd /app/infrastructure/terraform/vultr && terraform init -input=false

# Server hash script for FlareVault (run.sh calls ../../../server and node scripts/hash-admin-password.mjs)
COPY server/scripts/hash-admin-password.mjs ./server/scripts/
RUN echo '{"name":"server","private":true,"type":"module","dependencies":{"argon2":"^0.44.0"}}' > server/package.json \
  && cd server && npm install --omit=dev && cd /app

# Instance-manager app (runs from /app/manager so cwd has dist/, config.json, data.json)
WORKDIR /app/manager
COPY --from=app-builder /build/dist ./dist
COPY --from=app-builder /build/package.json ./
RUN npm install --omit=dev
RUN echo '{}' > config.json && echo '{}' > data.json

ENV NODE_ENV=production
ENV PORT=3999
EXPOSE 3999

# Ensure state dirs exist (e.g. when user mounts -v ./tfstate:/data)
ENTRYPOINT ["/bin/sh", "-c", "mkdir -p /data/aws /data/vultr && exec node dist/index.js"]
CMD []
