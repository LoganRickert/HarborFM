#!/usr/bin/env bash
# HarborFM - unified user-data script for cloud instances (EC2, Vultr, etc.)
# Set OS and DEPLOY_TYPE via env (e.g. from Terraform). Supports:
#   OS: debian-11, debian-12, debian-13, ubuntu-22, ubuntu-24, ubuntu-25, centos-9, centos-10, alpine-3
#   DEPLOY_TYPE: pm2 (bare metal), nginx (Docker), caddy (Docker)
set -e -o pipefail

# --- Required: passed by Terraform or caller ---
OS="${OS:-}"
DEPLOY_TYPE="${DEPLOY_TYPE:-pm2}"

# --- Common env vars ---
HARBORFM_REPO="${HARBORFM_REPO:-loganrickert/harborfm}"
HARBORFM_BRANCH="${HARBORFM_BRANCH:-main}"
DOMAIN="${DOMAIN:-localhost}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
SELF_SIGNED_CERT="${SELF_SIGNED_CERT:-0}"
TZ="${TZ:-UTC}"
SETUP_ID="${SETUP_ID:-}"
WEBRTC_ENABLED="${WEBRTC_ENABLED:-0}"
COOKIE_SECURE="${COOKIE_SECURE:-}"
BASE_URL="https://raw.githubusercontent.com/${HARBORFM_REPO}/${HARBORFM_BRANCH}"

# --- Deploy-type specific defaults ---
[ "$DEPLOY_TYPE" = "pm2" ] && INSTALL_DIR="${INSTALL_DIR:-/opt/harborfm}" || INSTALL_DIR="${INSTALL_DIR:-/opt/harborfm-docker}"
[ "$DEPLOY_TYPE" = "pm2" ] && DOMAIN="${DOMAIN:-_}"

# Log helper for admin bootstrap debugging (no secrets printed)
# PM2: uses ADMIN_PASSWORD_HASH_B64 (base64 hash in env for seed only). Docker: uses ADMIN_PASSWORD_HASH in .env.
log_admin_env() {
  local has_email="no"; [ -n "${ADMIN_EMAIL:-}" ] && has_email="yes"
  local has_b64="no"; [ -n "${ADMIN_PASSWORD_HASH_B64:-}" ] && has_b64="yes"
  local has_hash="no"; [ -n "${ADMIN_PASSWORD_HASH:-}" ] && has_hash="yes"
  echo "[harborfm-userdata] ADMIN_EMAIL set=$has_email ADMIN_PASSWORD_HASH_B64 set=$has_b64 ADMIN_PASSWORD_HASH set=$has_hash"
}

# --- Alpine: ensure community repo and base packages (idempotent, safe to call multiple times) ---
alpine_ensure_repo_and_base() {
  [ "${IS_ALPINE:-false}" != "true" ] && return 0
  sed -i 's|^#\s*\(.*/community\)|\1|' /etc/apk/repositories 2>/dev/null || true
  grep -qE '^[^#].*community' /etc/apk/repositories 2>/dev/null || \
    (ALPINE_VER=$(grep -oE 'v[0-9]+\.[0-9]+' /etc/apk/repositories 2>/dev/null | head -1); echo "http://dl-cdn.alpinelinux.org/alpine/${ALPINE_VER:-v3.19}/community" >> /etc/apk/repositories)
  apk update 2>/dev/null || true
  apk add --no-cache bash sudo 2>/dev/null || true
}

# --- Service helpers: OpenRC on Alpine, systemd elsewhere ---
enable_svc()  { local n="$1"; [ "$IS_ALPINE" = "true" ] && { rc-update add "$n" default 2>/dev/null || true; } || systemctl enable "$n"; }
start_svc()   { local n="$1"; [ "$IS_ALPINE" = "true" ] && { rc-service "$n" start 2>/dev/null || true; } || systemctl start "$n"; }
restart_svc() { local n="$1"; [ "$IS_ALPINE" = "true" ] && { rc-service "$n" restart 2>/dev/null || rc-service "$n" start 2>/dev/null || true; } || systemctl restart "$n"; }
reload_svc()  { local n="$1"; [ "$IS_ALPINE" = "true" ] && { rc-service "$n" reload 2>/dev/null || true; } || systemctl reload "$n"; }
stop_svc()    { local n="$1"; [ "$IS_ALPINE" = "true" ] && { rc-service "$n" stop 2>/dev/null || true; } || systemctl stop "$n"; }
disable_svc() { local n="$1"; [ "$IS_ALPINE" = "true" ] && { rc-update del "$n" default 2>/dev/null || true; } || systemctl disable "$n"; }
svc_running()  { local n="$1"; [ "$IS_ALPINE" = "true" ] && rc-service "$n" status 2>/dev/null | grep -q started || systemctl is-active --quiet "$n" 2>/dev/null; }

# --- Nginx PM2 config generator: mode http | https, https requires cert_dir, acme=1 for certbot ---
write_nginx_harborfm_conf() {
  local dest="$1" mode="$2" cert_dir="${3:-}" acme="${4:-0}"
  local webrtc_block
  [ "$WEBRTC_ENABLED" = "1" ] && webrtc_block=1 || webrtc_block=0
  {
    if [ "$mode" = "http" ]; then
      cat << NGINX_HTTP
server {
    ${LISTEN_80}
    ${LISTEN_80V6}
    server_name ${SERVER_NAME};
    server_tokens off;
    client_max_body_size 100M;
    client_body_timeout 600s;
    add_header X-Content-Type-Options "nosniff" always;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        try_files \$uri =404;
    }
NGINX_HTTP
      [ "$webrtc_block" = "1" ] && cat << 'NGINX_WEBRTC'
    location /webrtc-ws/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
NGINX_WEBRTC
      cat << 'NGINX_REST'
    location ~ ^/api/episodes/[^/]+/ws$ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 60s;
        proxy_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
NGINX_REST
    else
      if [ "$acme" = "1" ]; then
        cat << NGINX_80A
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; try_files \$uri =404; }
    location / { return 301 https://\$host\$request_uri; }
}
NGINX_80A
      else
        cat << NGINX_80B
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location / { return 301 https://\$host\$request_uri; }
}
NGINX_80B
      fi
      cat << NGINX_443
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    ssl_certificate $cert_dir/fullchain.pem;
    ssl_certificate_key $cert_dir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 100M;
    client_body_timeout 600s;
    add_header X-Content-Type-Options "nosniff" always;
NGINX_443
      [ "$webrtc_block" = "1" ] && cat << 'NGINX_W2'
    location /webrtc-ws/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
NGINX_W2
      cat << 'NGINX_443REST'
    location ~ ^/api/episodes/[^/]+/ws$ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 60s;
        proxy_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
    }
}
NGINX_443REST
    fi
  } > "$dest"
}

# --- Mount data-volume script (unified for Docker and PM2; detects at runtime) ---
write_mount_data_volume_script() {
  cat << 'MOUNT_SCRIPT_END'
#!/usr/bin/env bash
set -e
MOUNT_DATA="/mnt/harborfm-data"
INSTALL_DIR_PM2="/opt/harborfm"
INSTALL_DIR_DOCKER="/opt/harborfm-docker"
PM2_USER="harborfm"
DOCKER_USER="harborfm"
[ -d "$INSTALL_DIR_DOCKER" ] || INSTALL_DIR_DOCKER=""
mkdir -p "$MOUNT_DATA"
get_root_block() { local src="" pk=""; src=$(findmnt -n -o SOURCE / 2>/dev/null) || true; [ -z "$src" ] && return; pk=$(lsblk -no PKNAME "$src" 2>/dev/null); [ -n "$pk" ] && echo "/dev/$pk" || echo "$src"; }
ROOT_DEV=$(get_root_block)
is_device_safe() { local d="$1"; [ -z "$d" ] && return 1; [ -z "$ROOT_DEV" ] && return 1; [ "$d" = "$ROOT_DEV" ] && return 1; findmnt -S "$d" 2>/dev/null | grep -q . && return 1; return 0; }
MOUNT_SCRIPT_END
  cat << 'MOUNT_SCRIPT_END2'
DEV=""
if [ -f /etc/harborfm/data-volume-device ]; then
  CONFIG_DEV=$(cat /etc/harborfm/data-volume-device 2>/dev/null | tr -d '\n')
  [ -n "$CONFIG_DEV" ] && [ -b "/dev/$CONFIG_DEV" ] && is_device_safe "/dev/$CONFIG_DEV" && DEV="/dev/$CONFIG_DEV"
fi
if [ -z "$DEV" ]; then
  for i in $(seq 1 45); do [ -b /dev/vdb ] || [ -b /dev/vdb1 ] || [ -b /dev/nvme1n1 ] || [ -b /dev/nvme1n1p1 ] || [ -b /dev/sdf ] || [ -b /dev/sdf1 ] || [ -b /dev/xvdf ] || [ -b /dev/xvdf1 ] && break; sleep 2; done
  CANDIDATES=(); for c in vdb vdb1 nvme1n1 nvme1n1p1 sdf sdf1 xvdf xvdf1; do [ -b "/dev/$c" ] || continue; is_device_safe "/dev/$c" && CANDIDATES+=("/dev/$c"); done
  [ ${#CANDIDATES[@]} -eq 1 ] && DEV="${CANDIDATES[0]}"
fi
if [ -n "$DEV" ] && ! mountpoint -q "$MOUNT_DATA" 2>/dev/null; then
  [ "$DEV" = "$ROOT_DEV" ] && { echo "[harborfm-mount] ERROR: Refusing to mkfs root device $DEV" >&2; exit 1; }
  HAS_FS=$(blkid -o value -s TYPE "$DEV" 2>/dev/null || true)
  if [ -z "$HAS_FS" ]; then
    echo "[harborfm-mount] New device $DEV: creating ext4 filesystem"
    mkfs.ext4 -F "$DEV"
  else
    echo "[harborfm-mount] Using existing filesystem on $DEV (type $HAS_FS)"
  fi
  mount "$DEV" "$MOUNT_DATA"
  UUID=$(blkid -s UUID -o value "$DEV" 2>/dev/null)
  FSTYPE=$(blkid -s TYPE -o value "$DEV" 2>/dev/null || echo "ext4")
  [ -n "$UUID" ] && ! grep -q "$MOUNT_DATA" /etc/fstab 2>/dev/null && echo "UUID=$UUID $MOUNT_DATA $FSTYPE defaults,nofail 0 2" >> /etc/fstab
fi
if [ -n "$DEV" ]; then
  if ! touch "$MOUNT_DATA/.harborfm-write-test" 2>/dev/null || ! rm -f "$MOUNT_DATA/.harborfm-write-test" 2>/dev/null; then
    echo "[harborfm-mount] ERROR: $MOUNT_DATA is read-only. Refusing to continue - proceeding would cause data loss on subsequent terraform apply. Check: dmesg | grep -i ext4; run fsck on the block device; remount rw." >&2
    exit 1
  fi
  mkdir -p "$MOUNT_DATA/data" "$MOUNT_DATA/secrets" "$MOUNT_DATA/webrtc"
  if [ -n "$INSTALL_DIR_DOCKER" ]; then
    mkdir -p "$MOUNT_DATA/proxy/certbot/webroot" "$MOUNT_DATA/proxy/certbot/certs" \
      "$MOUNT_DATA/proxy/nginx/logs" "$MOUNT_DATA/proxy/nginx/sites-enabled" \
      "$MOUNT_DATA/proxy/caddy/data" "$MOUNT_DATA/proxy/caddy/config" "$MOUNT_DATA/proxy/caddy/logs" \
      "$MOUNT_DATA/whisper/cache"
    [ -f "$MOUNT_DATA/proxy/nginx/sites-enabled/00-placeholder.conf" ] || echo '# Placeholder' > "$MOUNT_DATA/proxy/nginx/sites-enabled/00-placeholder.conf"
    [ -d "$INSTALL_DIR_DOCKER" ] && {
      HF="$INSTALL_DIR_DOCKER/harborfm-data"
      if [ -L "$HF" ]; then rm -f "$HF"
      elif [ -d "$HF" ]; then
        if [ ! -d "$MOUNT_DATA/data" ] || [ -z "$(ls -A "$MOUNT_DATA/data" 2>/dev/null)" ]; then
          rsync -a --ignore-errors "$HF/" "$MOUNT_DATA/" 2>/dev/null || { for f in "$HF"/*; do [ -e "$f" ] && cp -a "$f" "$MOUNT_DATA/"; done; }
        fi
        rm -rf "$HF"
      fi
      ln -sf "$MOUNT_DATA" "$HF"
      chown -h 10001:10001 "$HF" 2>/dev/null || chown -h "$DOCKER_USER:$DOCKER_USER" "$HF" 2>/dev/null || true
    }
    chown -R 10001:10001 "$MOUNT_DATA" 2>/dev/null || chown -R "$DOCKER_USER:$DOCKER_USER" "$MOUNT_DATA"
  fi
  ENV_FILE="$INSTALL_DIR_PM2/server/.env"
  if [ -f "$ENV_FILE" ]; then
    sed -i "s|^DATA_DIR=.*|DATA_DIR=$MOUNT_DATA/data|" "$ENV_FILE"
    sed -i "s|^SECRETS_DIR=.*|SECRETS_DIR=$MOUNT_DATA/secrets|" "$ENV_FILE"
    sed -i "s|^WEBRTC_RECORDINGS_DIR=.*|WEBRTC_RECORDINGS_DIR=$MOUNT_DATA/webrtc|" "$ENV_FILE"
    su - "$PM2_USER" -c "cd $INSTALL_DIR_PM2 && pm2 restart all --update-env" 2>/dev/null || true
  fi
fi
MOUNT_SCRIPT_END2
}

# --- Install mount data-volume service unit (OpenRC or systemd) ---
install_mount_service_unit() {
  if [ "$IS_ALPINE" = "true" ]; then
    cat > /etc/init.d/harborfm-mount-data-volume << 'MOUNT_OPENRC'
#!/sbin/openrc-run
description="Mount HarborFM data volume (block storage)"
depend() {
    need localmount
    before bootmisc
}
start() {
    /usr/local/bin/harborfm-mount-data-volume.sh
}
stop() {
    true
}
MOUNT_OPENRC
    chmod +x /etc/init.d/harborfm-mount-data-volume
    rc-update add harborfm-mount-data-volume default 2>/dev/null || true
  else
    cat > /etc/systemd/system/harborfm-mount-data-volume.service << 'MOUNT_SVC'
[Unit]
Description=Mount HarborFM data volume (block storage)
After=local-fs.target systemd-udev-settle.service
Before=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
# Wait for block device (e.g. Vultr attaches after instance boot); poll up to ~70s so mount can succeed
ExecStartPre=/bin/sh -c 'sleep 10; for i in $(seq 1 30); do [ -b /dev/vdb ] || [ -b /dev/vdb1 ] || [ -b /dev/nvme1n1 ] || [ -b /dev/nvme1n1p1 ] && exit 0; sleep 2; done; exit 0'
ExecStart=/usr/local/bin/harborfm-mount-data-volume.sh

[Install]
WantedBy=multi-user.target
MOUNT_SVC
    systemctl daemon-reload
    systemctl enable harborfm-mount-data-volume.service
  fi
}

# --- Caddy PM2 config generator: conditionally includes /webrtc-ws when WEBRTC_ENABLED=1 ---
write_caddy_harborfm_conf() {
  local dest="${1:-/etc/caddy/Caddyfile}"
  {
    cat << 'CADDY_HEAD'
{
	log { output file /var/log/caddy/access.log; format json }
}
:80 {
CADDY_HEAD
    if [ "$WEBRTC_ENABLED" = "1" ]; then
      cat << 'CADDY_WEBRTC'
	handle_path /webrtc-ws/* {
		reverse_proxy 127.0.0.1:3002 {
			header_up Host {host} header_up X-Real-IP {remote_host} header_up X-Forwarded-For {remote_host} header_up X-Forwarded-Proto {scheme}
			header_up Upgrade {http.request.header.Upgrade} header_up Connection {http.request.header.Connection}
			transport http { read_timeout 86400s; write_timeout 86400s }
		}
	}
	handle {
		reverse_proxy 127.0.0.1:3001 {
			header_up Host {host} header_up X-Real-IP {remote_host} header_up X-Forwarded-For {remote_host} header_up X-Forwarded-Proto {scheme}
			header_up Upgrade {http.request.header.Upgrade} header_up Connection {http.request.header.Connection}
			transport http { read_timeout 600s; write_timeout 600s }
		}
	}
}
CADDY_WEBRTC
    else
      cat << 'CADDY_MAIN'
	reverse_proxy 127.0.0.1:3001 {
		header_up Host {host} header_up X-Real-IP {remote_host} header_up X-Forwarded-For {remote_host} header_up X-Forwarded-Proto {scheme}
		header_up Upgrade {http.request.header.Upgrade} header_up Connection {http.request.header.Connection}
		transport http { read_timeout 600s; write_timeout 600s }
	}
}
CADDY_MAIN
    fi
  } > "$dest"
}

# When domain and certbot_email are both empty: use public IP for domain
# When admin_hostname is empty and self_signed_cert=1: use https://<ip>
PUBLIC_IP="$(curl -s ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo '')"
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP="$(curl -s -4 ifconfig.me 2>/dev/null)" || true
fi
[ -z "$PUBLIC_IP" ] && PUBLIC_IP="localhost"
if [ -z "${CERTBOT_EMAIL}" ] && { [ -z "${DOMAIN}" ] || [ "$DOMAIN" = "localhost" ] || [ "$DOMAIN" = "_" ]; }; then
  DOMAIN="$PUBLIC_IP"
fi
if [ -z "${ADMIN_HOSTNAME}" ] && [ "$SELF_SIGNED_CERT" = "1" ]; then
  ADMIN_HOSTNAME="https://${PUBLIC_IP}"
fi

# Auto-detect OS if not set (from /etc/os-release)
if [ -z "$OS" ]; then
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "${ID:-}" in
      debian) OS="debian-${VERSION_ID:-12}" ;;
      ubuntu) OS="ubuntu-$(echo "${VERSION_ID:-22.04}" | cut -d. -f1)" ;;
      centos|rhel|rocky|almalinux) OS="centos-${VERSION_ID:-9}" ;;
      alpine) OS="alpine-$(echo "${VERSION_ID:-3.19}" | cut -d. -f1)" ;;
      *) OS="debian-12" ;;
    esac
  else
    OS="debian-12"
  fi
fi

# Validate OS and DEPLOY_TYPE
case "$OS" in debian-11|debian-12|debian-13|ubuntu-22|ubuntu-24|ubuntu-25|centos-9|centos-10|alpine-3) ;; *)
  echo "ERROR: Unsupported OS '$OS'. Use debian-11, debian-12, debian-13, ubuntu-22, ubuntu-24, ubuntu-25, centos-9, centos-10, or alpine-3." >&2
  exit 1
esac
case "$DEPLOY_TYPE" in pm2|nginx|caddy) ;; *)
  echo "ERROR: Unsupported DEPLOY_TYPE '$DEPLOY_TYPE'. Use pm2, nginx, or caddy." >&2
  exit 1
esac

# Log admin env early so we can see if Terraform/caller passed them (and after re-exec for Docker)
log_admin_env

# OS family for branching
IS_DEB=false
IS_UBUNTU=false
IS_CENTOS=false
IS_ALPINE=false
case "$OS" in
  debian-*) IS_DEB=true ;;
  ubuntu-*) IS_DEB=true; IS_UBUNTU=true ;;
  centos-*) IS_CENTOS=true ;;
  alpine-*) IS_ALPINE=true ;;
esac

# Debian frontend for non-interactive apt
$IS_DEB && export DEBIAN_FRONTEND=noninteractive

# Docker deploy: REVERSE_PROXY is nginx or caddy
[ "$DEPLOY_TYPE" = "nginx" ] && REVERSE_PROXY=nginx
[ "$DEPLOY_TYPE" = "caddy" ] && REVERSE_PROXY=caddy

# PM2 deploy: REVERSE_PROXY from env
[ "$DEPLOY_TYPE" = "pm2" ] && REVERSE_PROXY="${REVERSE_PROXY:-nginx}"

# Append SSH public key to root if provided (Terraform ssh_public_key). Used by both PM2 (root) and Docker (copied to harborfm).
if [ "$(id -u)" -eq 0 ] && [ -n "${SSH_PUBLIC_KEY_B64:-}" ]; then
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  decoded=$(echo "$SSH_PUBLIC_KEY_B64" | base64 -d 2>/dev/null || true)
  if [ -n "$decoded" ] && ! grep -qF "$decoded" /root/.ssh/authorized_keys 2>/dev/null; then
    echo "$decoded" >> /root/.ssh/authorized_keys
  fi
  chmod 600 /root/.ssh/authorized_keys 2>/dev/null || true
  # Ensure SSH host keys exist (some cloud images don't generate them until first sshd start; we restart below)
  if ! ls /etc/ssh/ssh_host_*_key 2>/dev/null | grep -q .; then
    echo "No SSH host keys found; generating..."
    [ -d /etc/ssh ] || mkdir -p /etc/ssh
    ssh-keygen -t ed25519 -f /etc/ssh/ssh_host_ed25519_key -N "" < /dev/null
    ssh-keygen -t rsa -b 4096 -f /etc/ssh/ssh_host_rsa_key -N "" < /dev/null
    chmod 600 /etc/ssh/ssh_host_*_key 2>/dev/null || true
  fi
  # Disable password login when key-based auth is configured (drop-in for OpenSSH)
  mkdir -p /etc/ssh/sshd_config.d
  echo "PasswordAuthentication no" > /etc/ssh/sshd_config.d/99-harborfm-no-passwd.conf
  if [ "$IS_ALPINE" = "true" ]; then
    rc-service sshd restart 2>/dev/null || true
  else
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
  fi
fi

# =============================================================================
# DOCKER DEPLOY (nginx or caddy)
# =============================================================================
if [ "$DEPLOY_TYPE" != "pm2" ]; then
  trap 'echo "ERROR: HarborFM install failed at line $LINENO (exit $?). Check the output above for details." >&2; exit 1' ERR
  DATA_DIR=""
  SECRETS_DIR=""
  # Non-root user setup when running as root
  if [ "$(id -u)" -eq 0 ]; then
    alpine_ensure_repo_and_base
    NEW_USER="${NEW_USER:-harborfm}"
    # For Docker: UID 10001 matches harborfm image's appuser so bind-mounted data is writable. Create user with that UID when possible.
    if id "$NEW_USER" &>/dev/null; then :; else
      if [ "$IS_ALPINE" = "true" ]; then
        adduser -D -h "/home/$NEW_USER" -s /bin/bash "$NEW_USER" 2>/dev/null || adduser -D -h "/home/$NEW_USER" -s /bin/sh "$NEW_USER"
        # Set UID 10001 for Docker bind-mount compatibility (adduser has no -u)
        sed -i "s/^${NEW_USER}:x:[0-9]*:/${NEW_USER}:x:10001:/" /etc/passwd 2>/dev/null || true
      else
        useradd -m -s /bin/bash -u 10001 "$NEW_USER" 2>/dev/null || useradd -m -s /bin/bash "$NEW_USER"
      fi
    fi
    echo "$NEW_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$NEW_USER"
    chmod 440 "/etc/sudoers.d/$NEW_USER"
    mkdir -p "/home/$NEW_USER/.ssh" && chmod 700 "/home/$NEW_USER/.ssh"
    if [ -n "${SSH_AUTHORIZED_KEYS:-}" ]; then
      [ -f "${SSH_AUTHORIZED_KEYS}" ] && cp "${SSH_AUTHORIZED_KEYS}" "/home/$NEW_USER/.ssh/authorized_keys" || echo "$SSH_AUTHORIZED_KEYS" > "/home/$NEW_USER/.ssh/authorized_keys"
    elif [ -f /root/.ssh/authorized_keys ]; then
      cp /root/.ssh/authorized_keys "/home/$NEW_USER/.ssh/authorized_keys"
    fi
    chmod 600 "/home/$NEW_USER/.ssh/authorized_keys" 2>/dev/null || true
    chown -R "$NEW_USER:$NEW_USER" "/home/$NEW_USER"

    # Mount block storage and put Docker data on it (before re-exec)
    MOUNT_DATA="/mnt/harborfm-data"
    mkdir -p "$MOUNT_DATA"
    if [ "$IS_CENTOS" = "true" ] && ! command -v blkid &>/dev/null; then
      DNF_EARLY="$(command -v dnf 2>/dev/null || command -v yum 2>/dev/null)"
      [ -x "$DNF_EARLY" ] && "$DNF_EARLY" install -y e2fsprogs 2>/dev/null || true
    fi
    get_root_block() {
      local src="" pk=""
      src=$(findmnt -n -o SOURCE / 2>/dev/null) || true
      [ -z "$src" ] && return
      pk=$(lsblk -no PKNAME "$src" 2>/dev/null)
      if [ -n "$pk" ]; then echo "/dev/$pk"; else echo "$src"; fi
    }
    is_device_safe() {
      local d="$1"
      [ -z "$d" ] && return 1
      [ -z "${ROOT_DEV:-}" ] && return 1
      [ "$d" = "$ROOT_DEV" ] && return 1
      findmnt -S "$d" 2>/dev/null | grep -q . && return 1
      return 0
    }
    ROOT_DEV=$(get_root_block)
    DEV=""
    for i in $(seq 1 60); do
      if [ -n "${DATA_VOLUME_DEVICE:-}" ] && [ -b "/dev/${DATA_VOLUME_DEVICE}" ]; then break; fi
      [ -b /dev/vdb ] || [ -b /dev/vdb1 ] || [ -b /dev/nvme1n1 ] || [ -b /dev/nvme1n1p1 ] || [ -b /dev/sdf ] || [ -b /dev/sdf1 ] || [ -b /dev/xvdf ] || [ -b /dev/xvdf1 ] && break
      sleep 2
    done
    if [ -n "${DATA_VOLUME_DEVICE:-}" ] && [ -b "/dev/${DATA_VOLUME_DEVICE}" ]; then
      CANDIDATE="/dev/${DATA_VOLUME_DEVICE}"
      is_device_safe "$CANDIDATE" && DEV="$CANDIDATE" || echo "[harborfm-userdata] WARNING: DATA_VOLUME_DEVICE invalid; skipping block volume"
    else
      CANDIDATES=()
      for c in vdb vdb1 nvme1n1 nvme1n1p1 sdf sdf1 xvdf xvdf1; do
        [ -b "/dev/$c" ] || continue
        is_device_safe "/dev/$c" && CANDIDATES+=("/dev/$c")
      done
      [ ${#CANDIDATES[@]} -eq 1 ] && DEV="${CANDIDATES[0]}" || [ ${#CANDIDATES[@]} -gt 1 ] && echo "[harborfm-userdata] WARNING: Multiple block devices; set DATA_VOLUME_DEVICE. Skipping."
    fi
    if [ -n "$DEV" ]; then
      mkdir -p /etc/harborfm
      echo "${DEV#/dev/}" > /etc/harborfm/data-volume-device
      if ! mountpoint -q "$MOUNT_DATA" 2>/dev/null; then
        [ "$DEV" = "$ROOT_DEV" ] && { echo "[harborfm-userdata] ERROR: Refusing to mkfs root device $DEV" >&2; exit 1; }
        HAS_FS=$(blkid -o value -s TYPE "$DEV" 2>/dev/null || true)
        if [ -z "$HAS_FS" ]; then
          echo "[harborfm-userdata] New device $DEV: creating ext4 filesystem"
          mkfs.ext4 -F "$DEV"
        else
          echo "[harborfm-userdata] Using existing filesystem on $DEV (type $HAS_FS)"
        fi
        mount "$DEV" "$MOUNT_DATA"
        UUID=$(blkid -s UUID -o value "$DEV" 2>/dev/null)
        FSTYPE=$(blkid -s TYPE -o value "$DEV" 2>/dev/null || echo "ext4")
        [ -n "$UUID" ] && ! grep -q "$MOUNT_DATA" /etc/fstab 2>/dev/null && echo "UUID=$UUID $MOUNT_DATA $FSTYPE defaults,nofail 0 2" >> /etc/fstab
      fi
      # Fail closed: read-only mount causes silent data loss on subsequent terraform apply
      if ! touch "$MOUNT_DATA/.harborfm-write-test" 2>/dev/null || ! rm -f "$MOUNT_DATA/.harborfm-write-test" 2>/dev/null; then
        echo "[harborfm-userdata] ERROR: $MOUNT_DATA is read-only. Refusing to continue - proceeding would cause data loss on subsequent terraform apply. Check: dmesg | grep -i ext4; run fsck on the block device; remount rw." >&2
        exit 1
      fi
      # Shared layout: data, secrets, webrtc (PM2-compatible). Proxy infra under proxy/, whisper under whisper/
      mkdir -p "$MOUNT_DATA/data" "$MOUNT_DATA/secrets" "$MOUNT_DATA/webrtc" \
        "$MOUNT_DATA/proxy/certbot/webroot" "$MOUNT_DATA/proxy/certbot/certs" \
        "$MOUNT_DATA/proxy/nginx/logs" "$MOUNT_DATA/proxy/nginx/sites-enabled" \
        "$MOUNT_DATA/proxy/caddy/data" "$MOUNT_DATA/proxy/caddy/config" "$MOUNT_DATA/proxy/caddy/logs" \
        "$MOUNT_DATA/whisper/cache"
      echo '# Placeholder' > "$MOUNT_DATA/proxy/nginx/sites-enabled/00-placeholder.conf"
      touch "$MOUNT_DATA/proxy/caddy/logs/access.log" "$MOUNT_DATA/proxy/nginx/logs/access.log" 2>/dev/null || true
      mkdir -p "$INSTALL_DIR"
      rm -rf "$INSTALL_DIR/harborfm-data" 2>/dev/null || true
      ln -sf "$MOUNT_DATA" "$INSTALL_DIR/harborfm-data"
      # Chown to 10001:10001 (Docker appuser) so container can write; fallback to NEW_USER if 10001 not used
      chown -R "10001:10001" "$MOUNT_DATA" 2>/dev/null || chown -R "$NEW_USER:$NEW_USER" "$MOUNT_DATA"

      # Install boot mount script (unified for Docker and PM2)
      write_mount_data_volume_script > /usr/local/bin/harborfm-mount-data-volume.sh
      chmod +x /usr/local/bin/harborfm-mount-data-volume.sh
      install_mount_service_unit
    fi

    SCRIPT_PATH="$0"
    [[ "$SCRIPT_PATH" != /* ]] && SCRIPT_PATH="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd)/$(basename "$SCRIPT_PATH")"
    SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || echo "$SCRIPT_PATH")"
    SCRIPT_COPY="/tmp/harborfm-userdata-$$.sh"
    cp "$SCRIPT_PATH" "$SCRIPT_COPY" 2>/dev/null || cp "$0" "$SCRIPT_COPY" 2>/dev/null || cp "$BASH_SOURCE" "$SCRIPT_COPY" 2>/dev/null || true
    chmod 755 "$SCRIPT_COPY" && chown "$NEW_USER:$NEW_USER" "$SCRIPT_COPY"
    echo "[harborfm-userdata] Re-exec as $NEW_USER (Docker path); passing ADMIN_EMAIL and ADMIN_PASSWORD_HASH into env"
    log_admin_env
    exec sudo -u "$NEW_USER" env -i HOME="/home/$NEW_USER" \
      OS="$OS" DEPLOY_TYPE="$DEPLOY_TYPE" HARBORFM_REPO="$HARBORFM_REPO" HARBORFM_BRANCH="$HARBORFM_BRANCH" \
      INSTALL_DIR="$INSTALL_DIR" DOMAIN="$DOMAIN" CERTBOT_EMAIL="$CERTBOT_EMAIL" TZ="$TZ" \
      SETUP_ID="$SETUP_ID" WEBRTC_ENABLED="$WEBRTC_ENABLED" COOKIE_SECURE="$COOKIE_SECURE" \
      MEDIASOUP_ANNOUNCED_IP="${MEDIASOUP_ANNOUNCED_IP:-}" \
      ADMIN_EMAIL="${ADMIN_EMAIL:-}" ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}" \
      ADMIN_REGISTRATION_ENABLED="${ADMIN_REGISTRATION_ENABLED:-}" ADMIN_PUBLIC_FEEDS_ENABLED="${ADMIN_PUBLIC_FEEDS_ENABLED:-}" ADMIN_HOSTNAME="${ADMIN_HOSTNAME:-}" \
      DEBIAN_FRONTEND=noninteractive \
      PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
      /bin/bash "$SCRIPT_COPY"
  fi

  # Install Docker
  if [ "$IS_ALPINE" = "true" ]; then
    sudo apk update
    sudo apk add --no-cache docker docker-cli-compose
  elif $IS_DEB; then
    echo "[harborfm-userdata] Waiting for dpkg lock..."
    for _ in $(seq 1 24); do
      sudo apt-get update -y 2>/dev/null && break
      sleep 5
    done
    sudo apt-get upgrade -y
    sudo apt-get install -y ca-certificates curl gnupg ufw
    sudo install -m 0755 -d /etc/apt/keyrings
    if $IS_UBUNTU; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      CODENAME="${VERSION_CODENAME:-$(. /etc/os-release 2>/dev/null; echo "${VERSION_CODENAME:-jammy}")}"
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME:-jammy} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    else
      curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      CODENAME="${VERSION_CODENAME:-$(. /etc/os-release 2>/dev/null; echo "${VERSION_CODENAME:-bookworm}")}"
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${CODENAME:-bookworm} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    fi
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"
    DNF_DOCKER="$(command -v dnf 2>/dev/null || command -v yum 2>/dev/null || echo /usr/bin/dnf)"
    [ ! -x "$DNF_DOCKER" ] && DNF_DOCKER="/usr/bin/yum"
    sudo "$DNF_DOCKER" install -y dnf-plugins-core
    sudo "$DNF_DOCKER" config-manager -y --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo "$DNF_DOCKER" install -y epel-release docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  if [ "$IS_ALPINE" = "true" ]; then
    sudo rc-update add docker default 2>/dev/null || true
    sudo rc-service docker start 2>/dev/null || true
  else
    sudo systemctl enable --now docker
  fi

  # Firewall: ufw on Debian/Ubuntu, firewalld on CentOS, iptables on Alpine
  if [ "$IS_ALPINE" = "true" ]; then
    sudo apk add --no-cache iptables 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p tcp --dport 3002 -j ACCEPT 2>/dev/null || true
    sudo iptables -I INPUT -p udp --dport 41000:41100 -j ACCEPT 2>/dev/null || true
  elif $IS_DEB; then
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow 22/tcp
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 3002/tcp
    sudo ufw allow 41000:41100/udp
    sudo ufw --force enable
  else
    sudo firewall-cmd --permanent --add-service=ssh
    sudo firewall-cmd --permanent --add-service=http
    sudo firewall-cmd --permanent --add-service=https
    sudo firewall-cmd --permanent --add-port=3002/tcp
    sudo firewall-cmd --permanent --add-port=41000-41100/udp
    sudo systemctl enable --now firewalld
    sudo firewall-cmd --reload
  fi

  # Download configs
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$(whoami):$(whoami)" "$INSTALL_DIR"
  download() { local u="$1" d="$2"; mkdir -p "$(dirname "$d")"; curl -fsSL "$u" -o "$d"; }
  download "$BASE_URL/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
  download "$BASE_URL/nginx/entrypoint.sh" "$INSTALL_DIR/nginx/entrypoint.sh"
  download "$BASE_URL/nginx/nginx-80-only.conf.template" "$INSTALL_DIR/nginx/nginx-80-only.conf.template"
  download "$BASE_URL/nginx/nginx-full.conf.template" "$INSTALL_DIR/nginx/nginx-full.conf.template"
  download "$BASE_URL/caddy/Caddyfile" "$INSTALL_DIR/caddy/Caddyfile"
  download "$BASE_URL/caddy/Caddyfile.webrtc" "$INSTALL_DIR/caddy/Caddyfile.webrtc"
  download "$BASE_URL/fail2ban/filter.d/nginx-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/nginx-scanner.conf"
  download "$BASE_URL/fail2ban/jail.d/nginx-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/nginx-scanner.local"
  download "$BASE_URL/fail2ban/filter.d/caddy-scanner.conf" "$INSTALL_DIR/fail2ban/filter.d/caddy-scanner.conf"
  download "$BASE_URL/fail2ban/jail.d/caddy-scanner.local" "$INSTALL_DIR/fail2ban/jail.d/caddy-scanner.local"
  download "$BASE_URL/update.sh" "$INSTALL_DIR/update.sh"
  download "$BASE_URL/nginx-add-domain.sh" "$INSTALL_DIR/nginx-add-domain.sh"
  chmod +x "$INSTALL_DIR/nginx/entrypoint.sh" "$INSTALL_DIR/update.sh" "$INSTALL_DIR/nginx-add-domain.sh"

  # ADMIN_PASSWORD_HASH: write to secrets file (chmod 600), not .env
  if [ -n "${ADMIN_PASSWORD_HASH:-}" ]; then
    mkdir -p "$INSTALL_DIR/harborfm-data/secrets"
    printf '%s' "$ADMIN_PASSWORD_HASH" > "$INSTALL_DIR/harborfm-data/secrets/admin_password_hash"
    chmod 600 "$INSTALL_DIR/harborfm-data/secrets/admin_password_hash" 2>/dev/null || true
  fi
  # mediasoup needs public IP when behind NAT; use MEDIASOUP_ANNOUNCED_IP from env (Terraform) or auto-detect
  if [ "$WEBRTC_ENABLED" = "1" ] && [ -z "${MEDIASOUP_ANNOUNCED_IP:-}" ]; then
    MEDIASOUP_ANNOUNCED_IP="$(curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null)"  # AWS
    [ -z "$MEDIASOUP_ANNOUNCED_IP" ] && MEDIASOUP_ANNOUNCED_IP="$(curl -s --connect-timeout 2 ifconfig.me 2>/dev/null)"
  fi
  # Image tag: main (or empty) -> latest; other branches -> sanitized branch name for Docker tag
  if [ -z "${HARBORFM_BRANCH:-}" ] || [ "$HARBORFM_BRANCH" = "main" ]; then
    HARBORFM_IMAGE_TAG="latest"
  else
    HARBORFM_IMAGE_TAG="$(echo "$HARBORFM_BRANCH" | tr '/' '-')"
  fi
  # .env
  {
    echo "INSTALL_DIR=$INSTALL_DIR"
    echo "HARBORFM_IMAGE_TAG=$HARBORFM_IMAGE_TAG"
    echo "DOMAIN=$DOMAIN"
    echo "REVERSE_PROXY=$REVERSE_PROXY"
    echo "CERTBOT_EMAIL=$CERTBOT_EMAIL"
    echo "TZ=$TZ"
    echo "WEBRTC_ENABLED=${WEBRTC_ENABLED:-0}"
    [ -n "$SETUP_ID" ] && echo "SETUP_ID=$SETUP_ID"
    [ -n "$COOKIE_SECURE" ] && echo "COOKIE_SECURE=$COOKIE_SECURE"
    [ -n "$ADMIN_EMAIL" ] && printf 'ADMIN_EMAIL=%s\n' "$ADMIN_EMAIL"
    [ -n "${ADMIN_PASSWORD_HASH:-}" ] && echo "ADMIN_PASSWORD_HASH_FILE=/secrets/admin_password_hash"
    [ -n "$ADMIN_REGISTRATION_ENABLED" ] && echo "ADMIN_REGISTRATION_ENABLED=$ADMIN_REGISTRATION_ENABLED"
    [ -n "$ADMIN_PUBLIC_FEEDS_ENABLED" ] && echo "ADMIN_PUBLIC_FEEDS_ENABLED=$ADMIN_PUBLIC_FEEDS_ENABLED"
    [ -n "$ADMIN_HOSTNAME" ] && echo "ADMIN_HOSTNAME=$ADMIN_HOSTNAME"
    if [ "$WEBRTC_ENABLED" = "1" ]; then
      echo "WEBRTC_SERVICE_URL=http://webrtc:3002"
      SCHEME="https"; [ "$DOMAIN" = "localhost" ] && SCHEME="http"
      echo "WEBRTC_PUBLIC_WS_URL=${SCHEME}://${DOMAIN}/webrtc-ws"
      echo "WEBRTC_SERVICE_SECRET=${WEBRTC_SERVICE_SECRET:-$(openssl rand -base64 32)}"
      echo "RECORDING_CALLBACK_SECRET=${RECORDING_CALLBACK_SECRET:-$(openssl rand -base64 32)}"
      [ -n "${MEDIASOUP_ANNOUNCED_IP:-}" ] && echo "MEDIASOUP_ANNOUNCED_IP=$MEDIASOUP_ANNOUNCED_IP"
    fi
    [ "$REVERSE_PROXY" = "caddy" ] && echo "CADDY_TLS_CHECK_SECRET=${CADDY_TLS_CHECK_SECRET:-$(openssl rand -hex 32)}"
  } > "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  chmod 750 "$INSTALL_DIR" 2>/dev/null || true
  echo "[harborfm-userdata] Wrote $INSTALL_DIR/.env (ADMIN_EMAIL and ADMIN_PASSWORD_HASH_FILE when set; hash in secrets file)"
  log_admin_env

  # Create dirs (shared layout: data, secrets, webrtc; proxy infra under proxy/, whisper under whisper/)
  mkdir -p \
    "$INSTALL_DIR/harborfm-data/data" \
    "$INSTALL_DIR/harborfm-data/secrets" \
    "$INSTALL_DIR/harborfm-data/webrtc" \
    "$INSTALL_DIR/harborfm-data/proxy/certbot/webroot" \
    "$INSTALL_DIR/harborfm-data/proxy/certbot/certs" \
    "$INSTALL_DIR/harborfm-data/proxy/nginx/logs" \
    "$INSTALL_DIR/harborfm-data/proxy/nginx/sites-enabled" \
    "$INSTALL_DIR/harborfm-data/proxy/caddy/data" \
    "$INSTALL_DIR/harborfm-data/proxy/caddy/config" \
    "$INSTALL_DIR/harborfm-data/proxy/caddy/logs" \
    "$INSTALL_DIR/harborfm-data/whisper/cache"
  [ -f "$INSTALL_DIR/harborfm-data/proxy/nginx/sites-enabled/00-placeholder.conf" ] || echo '# Placeholder' > "$INSTALL_DIR/harborfm-data/proxy/nginx/sites-enabled/00-placeholder.conf"
  touch "$INSTALL_DIR/harborfm-data/proxy/caddy/logs/access.log" "$INSTALL_DIR/harborfm-data/proxy/nginx/logs/access.log" 2>/dev/null || true

  # Caddy: use WebRTC-enabled Caddyfile when webrtc profile is used; else default (respond 503 for /webrtc-ws)
  [ "$REVERSE_PROXY" = "caddy" ] && [ "$WEBRTC_ENABLED" = "1" ] && cp "$INSTALL_DIR/caddy/Caddyfile.webrtc" "$INSTALL_DIR/caddy/Caddyfile"

  cd "$INSTALL_DIR"
  export INSTALL_DIR
  sudo docker compose --profile "$REVERSE_PROXY" $([ "$WEBRTC_ENABLED" = "1" ] && echo "--profile webrtc") up -d
  if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD_HASH:-}" ]; then
    echo "[harborfm-userdata] Admin env set; initial user is created by server on first boot. If not, check: docker compose logs server (look for [setup] bootstrap)"
  fi

  if [ -n "$CERTBOT_EMAIL" ] && [ "$DOMAIN" != "localhost" ] && [ "$REVERSE_PROXY" = "nginx" ]; then
    sleep 30
    sudo docker compose run --rm certbot 2>/dev/null || true
  fi

  SCHEME="https"; [ "$DOMAIN" = "localhost" ] && SCHEME="http"
  if [ -n "$SETUP_ID" ]; then
    echo "${SCHEME}://${DOMAIN}/setup?id=${SETUP_ID}" > "$INSTALL_DIR/setup.txt"
  else
    sleep 15
    TOKEN_FILE="$INSTALL_DIR/harborfm-data/data/setup-token.txt"  # same path as PM2
    [ -f "$TOKEN_FILE" ] && echo "${SCHEME}://${DOMAIN}/setup?id=$(cat "$TOKEN_FILE" | tr -d '\n')" > "$INSTALL_DIR/setup.txt"
  fi

  echo "HarborFM ($REVERSE_PROXY) ready at ${SCHEME}://${DOMAIN}/"
  [ -f "$INSTALL_DIR/setup.txt" ] && echo "Setup URL: $(cat "$INSTALL_DIR/setup.txt")"
  exit 0
fi

# =============================================================================
# PM2 DEPLOY (bare metal)
# =============================================================================
DATA_DIR="${DATA_DIR:-/var/lib/harborfm/data}"
SECRETS_DIR="${SECRETS_DIR:-/var/lib/harborfm/secrets}"
PM2_USER="${PM2_USER:-harborfm}"

# Mount persistent data volume when present (AWS EBS, Vultr block). Run every boot via systemd too so
# we catch volumes attached after first boot (e.g. Vultr attaches after instance create).
MOUNT_DATA="/mnt/harborfm-data"
mkdir -p "$MOUNT_DATA"

# CentOS/RHEL: ensure blkid and mkfs.ext4 exist before we probe/mount (minimal images may omit e2fsprogs)
if [ "$(id -u)" -eq 0 ] && [ "$IS_CENTOS" = "true" ] && ! command -v blkid &>/dev/null; then
  DNF_EARLY="$(command -v dnf 2>/dev/null || command -v yum 2>/dev/null)"
  [ -x "$DNF_EARLY" ] && "$DNF_EARLY" install -y e2fsprogs 2>/dev/null || true
fi

# Resolve root block device (never use for data volume). Handles partitions: /dev/vda1 -> /dev/vda.
get_root_block() {
  local src="" pk=""
  src=$(findmnt -n -o SOURCE / 2>/dev/null) || true
  [ -z "$src" ] && return
  pk=$(lsblk -no PKNAME "$src" 2>/dev/null)
  if [ -n "$pk" ]; then
    echo "/dev/$pk"
  else
    echo "$src"
  fi
}
ROOT_DEV=$(get_root_block)

# Check device is safe: not root, not already mounted
is_device_safe() {
  local d="$1"
  [ -z "$d" ] && return 1
  [ -z "$ROOT_DEV" ] && return 1
  [ "$d" = "$ROOT_DEV" ] && return 1
  findmnt -S "$d" 2>/dev/null | grep -q . && return 1
  return 0
}

# Wait for block device(s) to appear (e.g. Vultr attaches after instance create)
DEV=""
for i in $(seq 1 60); do
  if [ -n "${DATA_VOLUME_DEVICE:-}" ] && [ -b "/dev/${DATA_VOLUME_DEVICE}" ]; then
    break
  fi
  [ -b /dev/vdb ] || [ -b /dev/vdb1 ] || [ -b /dev/nvme1n1 ] || [ -b /dev/nvme1n1p1 ] || [ -b /dev/sdf ] || [ -b /dev/sdf1 ] || [ -b /dev/xvdf ] || [ -b /dev/xvdf1 ] && break
  sleep 2
done

# Select device with validation
if [ -n "${DATA_VOLUME_DEVICE:-}" ] && [ -b "/dev/${DATA_VOLUME_DEVICE}" ]; then
  CANDIDATE="/dev/${DATA_VOLUME_DEVICE}"
  if is_device_safe "$CANDIDATE"; then
    DEV="$CANDIDATE"
  else
    echo "[harborfm-userdata] WARNING: DATA_VOLUME_DEVICE=$DATA_VOLUME_DEVICE is root disk or already mounted; skipping block volume"
  fi
else
  CANDIDATES=()
  for c in vdb vdb1 nvme1n1 nvme1n1p1 sdf sdf1 xvdf xvdf1; do
    [ -b "/dev/$c" ] || continue
    if is_device_safe "/dev/$c"; then
      CANDIDATES+=("/dev/$c")
    fi
  done
  if [ ${#CANDIDATES[@]} -eq 1 ]; then
    DEV="${CANDIDATES[0]}"
  elif [ ${#CANDIDATES[@]} -gt 1 ]; then
    echo "[harborfm-userdata] WARNING: Multiple block devices found; set DATA_VOLUME_DEVICE explicitly. Skipping block volume."
  fi
fi

if [ -n "$DEV" ]; then
  mkdir -p /etc/harborfm
  echo "${DEV#/dev/}" > /etc/harborfm/data-volume-device

  if ! mountpoint -q "$MOUNT_DATA" 2>/dev/null; then
    if [ "$DEV" = "$ROOT_DEV" ]; then
      echo "[harborfm-userdata] ERROR: Refusing to mkfs root device $DEV" >&2
      exit 1
    fi
    HAS_FS=$(blkid -o value -s TYPE "$DEV" 2>/dev/null || true)
    if [ -z "$HAS_FS" ]; then
      echo "[harborfm-userdata] New device $DEV: creating ext4 filesystem"
      mkfs.ext4 -F "$DEV"
    else
      echo "[harborfm-userdata] Using existing filesystem on $DEV (type $HAS_FS)"
    fi
    mount "$DEV" "$MOUNT_DATA"
    UUID=$(blkid -s UUID -o value "$DEV" 2>/dev/null)
    FSTYPE=$(blkid -s TYPE -o value "$DEV" 2>/dev/null || echo "ext4")
    if [ -n "$UUID" ] && ! grep -q "$MOUNT_DATA" /etc/fstab 2>/dev/null; then
      echo "UUID=$UUID $MOUNT_DATA $FSTYPE defaults,nofail 0 2" >> /etc/fstab
    fi
  fi
  if ! touch "$MOUNT_DATA/.harborfm-write-test" 2>/dev/null || ! rm -f "$MOUNT_DATA/.harborfm-write-test" 2>/dev/null; then
    echo "[harborfm-userdata] ERROR: $MOUNT_DATA is read-only. Refusing to continue - proceeding would cause data loss on subsequent terraform apply. Check: dmesg | grep -i ext4; run fsck on the block device; remount rw." >&2
    exit 1
  fi
  mkdir -p "$MOUNT_DATA/data" "$MOUNT_DATA/secrets" "$MOUNT_DATA/webrtc"
  DATA_DIR="$MOUNT_DATA/data"
  SECRETS_DIR="$MOUNT_DATA/secrets"
  WEBRTC_DIR="$MOUNT_DATA/webrtc"
  export DATA_DIR SECRETS_DIR WEBRTC_DIR
fi

# Create harborfm user for running the app (not root)
if [ "$(id -u)" -eq 0 ]; then
  if [ "$IS_ALPINE" = "true" ]; then
    alpine_ensure_repo_and_base
    if ! id "$PM2_USER" &>/dev/null; then
      adduser -D -h "/home/$PM2_USER" -s /bin/bash "$PM2_USER" 2>/dev/null || adduser -D -h "/home/$PM2_USER" -s /bin/sh "$PM2_USER"
    fi
  else
    id "$PM2_USER" &>/dev/null || useradd -m -s /bin/bash "$PM2_USER"
  fi
  echo "$PM2_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/$PM2_USER"
  chmod 440 "/etc/sudoers.d/$PM2_USER"
  mkdir -p "/home/$PM2_USER/.ssh" && chmod 700 "/home/$PM2_USER/.ssh"
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys "/home/$PM2_USER/.ssh/authorized_keys"
    chmod 600 "/home/$PM2_USER/.ssh/authorized_keys"
  fi
  chown -R "$PM2_USER:$PM2_USER" "/home/$PM2_USER"
fi

# Install script + systemd unit to mount data volume on every boot (so Vultr block attached after first boot gets mounted)
if [ "$DEPLOY_TYPE" = "pm2" ] && [ "$(id -u)" -eq 0 ]; then
  write_mount_data_volume_script > /usr/local/bin/harborfm-mount-data-volume.sh
  chmod +x /usr/local/bin/harborfm-mount-data-volume.sh
  install_mount_service_unit
fi

# Package install: OS-specific
# Wait for unattended-upgrades (or other apt processes) to release dpkg lock before we use apt
if [ "$IS_ALPINE" = "true" ]; then
  apk update
  apk add --no-cache build-base ca-certificates curl git wget fail2ban cairo-dev pango-dev jpeg-dev giflib-dev
  if [ "$REVERSE_PROXY" = "caddy" ]; then
    apk add --no-cache caddy
  else
    apk add --no-cache nginx
    [ -n "$CERTBOT_EMAIL" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && apk add --no-cache certbot 2>/dev/null || true
  fi
  apk add --no-cache ffmpeg samba-client 2>/dev/null || true
  apk add --no-cache libmad libid3tag 2>/dev/null || true
  # audiowaveform: build from source on Alpine (no package)
  if ! command -v audiowaveform &>/dev/null; then
    apk add --no-cache cmake g++ libmad-dev libid3tag-dev libsndfile-dev gd-dev boost-dev 2>/dev/null || true
    (cd /tmp && rm -rf audiowaveform && git clone --depth 1 --branch 1.10.2 https://github.com/bbc/audiowaveform.git 2>/dev/null && \
     cd audiowaveform && mkdir -p build && cd build && \
     cmake -DENABLE_TESTS=0 -DCMAKE_INSTALL_PREFIX=/usr .. && make -j"$(nproc 2>/dev/null || echo 2)" && make install) 2>/dev/null || true
    rm -rf /tmp/audiowaveform 2>/dev/null || true
  fi
  LIBC_PATH="/lib/ld-musl-x86_64.so.1"
  [ ! -f "$LIBC_PATH" ] && LIBC_PATH="/lib/libc.musl-x86_64.so.1"
  [ ! -f "$LIBC_PATH" ] && LIBC_PATH="/dev/null"
elif $IS_DEB; then
  echo "[harborfm-userdata] Waiting for dpkg lock..."
  for _ in $(seq 1 24); do
    apt-get update -y 2>/dev/null && break
    sleep 5
  done
  # Upgrade base packages (reduces "X packages can be updated" motd on login)
  apt-get upgrade -y
  apt-get install -y build-essential ca-certificates curl git gnupg ufw wget fail2ban libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev
  if [ "$REVERSE_PROXY" = "caddy" ]; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    if $IS_UBUNTU; then
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/ubuntu.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    else
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null
    fi
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  else
    apt-get install -y nginx
    [ -n "$CERTBOT_EMAIL" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && apt-get install -y certbot || true
  fi
  # Debian contrib for geoipupdate (Ubuntu has it in main)
  if ! $IS_UBUNTU; then
    [ -f /etc/apt/sources.list.d/debian.sources ] && sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/debian.sources 2>/dev/null || sed -i 's/ main$/ main contrib/' /etc/apt/sources.list 2>/dev/null || true
  fi
  apt-get update -y
  apt-get install -y ffmpeg geoipupdate smbclient libmad0 libid3tag0
  case "$OS" in
    debian-11|ubuntu-22) BOOST_ORDER="1.74.0 1.67.0 1.81.0"; DEB_VER_ORDER="11 12 10" ;;
    debian-12)           BOOST_ORDER="1.74.0 1.81.0 1.67.0"; DEB_VER_ORDER="12 11 13 10" ;;
    ubuntu-24)           BOOST_ORDER="1.81.0 1.74.0 1.67.0"; DEB_VER_ORDER="12 11 13" ;;
    ubuntu-25|debian-13) BOOST_ORDER="1.81.0 1.74.0 1.67.0"; DEB_VER_ORDER="13 12 11" ;;
    *)                  BOOST_ORDER="1.74.0 1.81.0 1.67.0"; DEB_VER_ORDER="12 11 13 10" ;;
  esac
  for BOOST in $BOOST_ORDER; do
    apt-get install -y "libboost-program-options${BOOST}" 2>/dev/null && break || true
  done
  ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && DEB_ARCH="amd64" || DEB_ARCH="arm64"
  for DEB_VER in $DEB_VER_ORDER; do
    DEB_URL="https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform_1.10.2-1-${DEB_VER}_${DEB_ARCH}.deb"
    if wget -q -O /tmp/audiowaveform.deb "$DEB_URL" 2>/dev/null && [ -s /tmp/audiowaveform.deb ]; then
      dpkg -i /tmp/audiowaveform.deb 2>/dev/null || apt-get install -f -y
      rm -f /tmp/audiowaveform.deb
      break
    fi
  done
  LIBC_PATH="/lib/x86_64-linux-gnu/libc.so.6"
else
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"
  DNF="$(command -v dnf 2>/dev/null || command -v yum 2>/dev/null || echo /usr/bin/dnf)"
  if [ ! -x "$DNF" ]; then DNF="/usr/bin/yum"; fi
  if ! command -v dnf &>/dev/null && ! command -v yum &>/dev/null && [ ! -x /usr/bin/dnf ] && [ ! -x /usr/bin/yum ]; then
    echo "ERROR: Neither dnf nor yum found. Cannot install packages on CentOS/RHEL. Check PATH and that the package manager is installed." >&2
    exit 1
  fi
  $DNF update -y
  $DNF install -y epel-release curl git wget fail2ban
  $DNF group install -y "Development Tools"
  if [ "$REVERSE_PROXY" = "caddy" ]; then
    $DNF install -y 'dnf-command(copr)'
    $DNF copr enable -y @caddy/caddy
    $DNF install -y caddy
  else
    $DNF install -y nginx
    [ -n "$CERTBOT_EMAIL" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && $DNF install -y certbot 2>/dev/null || true
  fi
  # ffmpeg is in RPM Fusion on EL; requires CRB for ladspa (rubberband dep)
  # Use EL version: from OS (centos-10 -> 10), or detect from /etc/os-release VERSION_ID
  case "$OS" in
    centos-10) EL_VER=10 ;;
    centos-9)  EL_VER=9 ;;
    *)         EL_VER=9 ;;
  esac
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    # VERSION_ID for CentOS Stream 10 / RHEL 10 is "10" or "10.0"
    case "${VERSION_ID:-}" in
      10|10.*) EL_VER=10 ;;
      9|9.*)   EL_VER=9 ;;
      8|8.*)   EL_VER=8 ;;
    esac
  fi
  $DNF config-manager --set-enabled crb 2>/dev/null || $DNF config-manager --set-enabled codeready-builder-for-rhel-${EL_VER}-x86_64-rpms 2>/dev/null || true
  $DNF install -y https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-${EL_VER}.noarch.rpm https://mirrors.rpmfusion.org/nonfree/el/rpmfusion-nonfree-release-${EL_VER}.noarch.rpm 2>/dev/null || \
  $DNF install -y https://download1.rpmfusion.org/free/el/rpmfusion-free-release-${EL_VER}.noarch.rpm https://download1.rpmfusion.org/nonfree/el/rpmfusion-nonfree-release-${EL_VER}.noarch.rpm
  $DNF install -y ffmpeg samba-client
  $DNF install -y cairo-devel pango-devel libjpeg-turbo-devel giflib-devel
  ARCH=$(uname -m)
  # geoipupdate: not in EPEL/RPM Fusion for EL9; install from MaxMind official release
  if ! command -v geoipupdate &>/dev/null; then
    case "$ARCH" in
      x86_64) GEOIP_ARCH=amd64 ;;
      aarch64) GEOIP_ARCH=arm64 ;;
      i686|i386) GEOIP_ARCH=386 ;;
      *) GEOIP_ARCH=amd64 ;;
    esac
    GEOIP_VER=7.1.1
    GEOIP_RPM="geoipupdate_${GEOIP_VER}_linux_${GEOIP_ARCH}.rpm"
    GEOIP_URL="https://github.com/maxmind/geoipupdate/releases/download/v${GEOIP_VER}/${GEOIP_RPM}"
    if wget -q -O /tmp/geoipupdate.rpm "$GEOIP_URL" 2>/dev/null && [ -s /tmp/geoipupdate.rpm ]; then
      rpm -Uvh /tmp/geoipupdate.rpm 2>/dev/null || true
      rm -f /tmp/geoipupdate.rpm
    fi
  fi
  if [ "$ARCH" = "x86_64" ]; then
    # Try EL version matching OS first, then fallbacks (BBC provides el8 and el9)
    for AV_EL in $EL_VER 9 8; do
      RPM_URL="https://github.com/bbc/audiowaveform/releases/download/1.10.2/audiowaveform-1.10.2-1.el${AV_EL}.x86_64.rpm"
      if wget -q -O /tmp/audiowaveform.rpm "$RPM_URL" 2>/dev/null && [ -s /tmp/audiowaveform.rpm ]; then
        rpm -Uvh /tmp/audiowaveform.rpm 2>/dev/null || true
        rm -f /tmp/audiowaveform.rpm
        break
      fi
    done
  fi
  # Build from source when RPM not available or install failed (e.g. deps on newer EL)
  if ! command -v audiowaveform &>/dev/null; then
    $DNF install -y cmake gcc-c++ libmad-devel libid3tag-devel libsndfile-devel gd-devel boost-devel 2>/dev/null || \
      $DNF install -y cmake gcc-c++ gd-devel boost-devel 2>/dev/null
    if command -v cmake &>/dev/null; then
      (cd /tmp && rm -rf audiowaveform && git clone --depth 1 --branch 1.10.2 https://github.com/bbc/audiowaveform.git 2>/dev/null && \
       cd audiowaveform && mkdir -p build && cd build && \
       cmake -DENABLE_TESTS=0 -DCMAKE_INSTALL_PREFIX=/usr .. && make -j"$(nproc)" && make install) 2>/dev/null || true
      rm -rf /tmp/audiowaveform 2>/dev/null
    fi
  fi
  LIBC_PATH="/lib64/libc.so.6"
fi

# Firewall: ufw on Debian/Ubuntu, firewalld on CentOS, iptables on Alpine
if [ "$IS_ALPINE" = "true" ]; then
  apk add --no-cache iptables 2>/dev/null || true
  iptables -I INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
  iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
  [ "$WEBRTC_ENABLED" = "1" ] && iptables -I INPUT -p udp --dport 41000:41100 -j ACCEPT 2>/dev/null || true
elif $IS_DEB; then
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  [ "$WEBRTC_ENABLED" = "1" ] && ufw allow 41000:41100/udp
  ufw --force enable
else
  firewall-cmd --permanent --add-service=ssh
  firewall-cmd --permanent --add-service=http
  firewall-cmd --permanent --add-service=https
  [ "$WEBRTC_ENABLED" = "1" ] && firewall-cmd --permanent --add-port=41000-41100/udp
  systemctl enable --now firewalld
  firewall-cmd --reload
fi

# Node.js
if [ "$IS_ALPINE" = "true" ]; then
  apk add --no-cache nodejs npm
elif $IS_DEB; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  ${DNF:-dnf} install -y nodejs
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
corepack prepare pnpm@latest --activate
npm install -g pm2

# Clone and build
mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR" && git fetch && git checkout "$HARBORFM_BRANCH" && git pull
else
  git clone --branch "$HARBORFM_BRANCH" "https://github.com/${HARBORFM_REPO}.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# FlareVault: redeem token to get admin creds (after clone so we run server/scripts/flarevault-redeem.mjs)
if [ -n "${FLAREVAULT_URL:-}" ] && [ -n "${FLAREVAULT_REDEEM_TOKEN:-}" ] && [ -f "$INSTALL_DIR/server/scripts/flarevault-redeem.mjs" ]; then
  echo "[harborfm-userdata] FlareVault URL and redeem token set; redeeming for admin credentials..."
  PAYLOAD=$(cd "$INSTALL_DIR" && node server/scripts/flarevault-redeem.mjs "$FLAREVAULT_URL" "$FLAREVAULT_REDEEM_TOKEN" 2>/dev/null) || true
  if [ -n "$PAYLOAD" ]; then
    ADMIN_EMAIL=$(echo "$PAYLOAD" | jq -r '.admin_email // empty')
    _hash=$(echo "$PAYLOAD" | jq -r '.admin_password_hash // empty')
    ADMIN_PASSWORD_HASH_B64=$(echo "$_hash" | base64 -w 0 2>/dev/null || echo "$_hash" | base64 2>/dev/null | tr -d '\n')
    [ -z "$ADMIN_PASSWORD_HASH_B64" ] && ADMIN_PASSWORD_HASH_B64="$_hash"
    INITIAL_ADMIN_API_TOKEN=$(echo "$PAYLOAD" | jq -r '.initial_admin_api_token // empty')
    export ADMIN_EMAIL ADMIN_PASSWORD_HASH_B64
    [ -n "$INITIAL_ADMIN_API_TOKEN" ] && export INITIAL_ADMIN_API_TOKEN
    echo "[harborfm-userdata] FlareVault redeem succeeded; ADMIN_EMAIL and ADMIN_PASSWORD_HASH_B64 set for seed."
    [ -n "$INITIAL_ADMIN_API_TOKEN" ] && echo "[harborfm-userdata] INITIAL_ADMIN_API_TOKEN set for seed (API key will be created)."
  else
    echo "[harborfm-userdata] FlareVault redeem failed or returned empty; continuing without admin seed." >&2
  fi
fi

if [ "$WEBRTC_ENABLED" = "1" ]; then
  pnpm install --frozen-lockfile
  pnpm run build
  cp -R web/dist server/public
else
  pnpm install --frozen-lockfile --filter '!webrtc-service'
  pnpm --filter shared run build && pnpm --filter server run build && pnpm --filter web run build
  cp -R web/dist server/public
fi

# node-canvas: ensure native bindings build (needed for video generation)
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm -C node_modules/.pnpm/canvas@3.2.1/node_modules/canvas run install 2>/dev/null || true

# argon2: rebuild from source on older glibc (skip on Alpine/musl)
if [ "$IS_ALPINE" != "true" ] && ! strings "$LIBC_PATH" 2>/dev/null | grep -q 'GLIBC_2.34'; then
  ARGON2_DIR="$(find node_modules -path '*/argon2/package.json' 2>/dev/null | head -1 | xargs dirname)"
  if [ -n "$ARGON2_DIR" ] && [ -d "$ARGON2_DIR" ]; then
    rm -rf "$ARGON2_DIR/prebuilds"
    (cd "$ARGON2_DIR" && npx --yes node-gyp rebuild)
  fi
fi

WEBRTC_DIR="${WEBRTC_DIR:-/var/lib/harborfm/webrtc}"
mkdir -p "$DATA_DIR" "$SECRETS_DIR" "$INSTALL_DIR/logs"
[ "$WEBRTC_ENABLED" = "1" ] && mkdir -p "$WEBRTC_DIR"

# Persistent data present? (e.g. reattach after destroy+apply) - reuse secrets and run update-admin instead of full seed
PERSISTENT_DATA_EXISTS=""
if [ -f "$DATA_DIR/harborfm.db" ]; then
  PERSISTENT_DATA_EXISTS="1"
  echo "[harborfm-userdata] Existing data detected; will reuse secrets and update admin if email/hash changed"
  if [ -f "$SECRETS_DIR/bootstrap.env" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$SECRETS_DIR/bootstrap.env"
    set +a
  fi
fi

JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
HARBORFM_SECRETS_KEY="${HARBORFM_SECRETS_KEY:-$(openssl rand -base64 32)}"
if [ "$WEBRTC_ENABLED" = "1" ]; then
  WEBRTC_SERVICE_SECRET="${WEBRTC_SERVICE_SECRET:-$(openssl rand -base64 32)}"
  RECORDING_CALLBACK_SECRET="${RECORDING_CALLBACK_SECRET:-$(openssl rand -base64 32)}"
  # Use https when Let's Encrypt or self-signed cert will be used (so browser gets wss:// for WebSocket)
  PUBLIC_SCHEME="http"
  [ -n "$CERTBOT_EMAIL" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && PUBLIC_SCHEME="https"
  [ "$PUBLIC_SCHEME" = "http" ] && [ "$SELF_SIGNED_CERT" = "1" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && PUBLIC_SCHEME="https"
  PUBLIC_BASE="${PUBLIC_SCHEME}://${DOMAIN}"
  [ "$DOMAIN" = "_" ] && PUBLIC_BASE="${PUBLIC_SCHEME}://$(curl -s ifconfig.me 2>/dev/null || hostname -f 2>/dev/null || echo localhost)"
  # mediasoup needs public IP when behind NAT; use MEDIASOUP_ANNOUNCED_IP from env (Terraform) or auto-detect
  if [ -z "${MEDIASOUP_ANNOUNCED_IP:-}" ]; then
    MEDIASOUP_ANNOUNCED_IP="$(curl -s --connect-timeout 2 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null)"  # AWS
    [ -z "$MEDIASOUP_ANNOUNCED_IP" ] && MEDIASOUP_ANNOUNCED_IP="$(curl -s --connect-timeout 2 ifconfig.me 2>/dev/null)"
  fi
fi

if [ "$WEBRTC_ENABLED" = "1" ]; then
  cat > "$INSTALL_DIR/server/.env" << EOF
NODE_ENV=production
PORT=3001
DATA_DIR=$DATA_DIR
SECRETS_DIR=$SECRETS_DIR
JWT_SECRET=$JWT_SECRET
HARBORFM_SECRETS_KEY=$HARBORFM_SECRETS_KEY
WEBRTC_SERVICE_URL=http://127.0.0.1:3002
WEBRTC_PUBLIC_WS_URL=$PUBLIC_BASE/webrtc-ws
WEBRTC_SERVICE_SECRET=$WEBRTC_SERVICE_SECRET
RECORDING_CALLBACK_SECRET=$RECORDING_CALLBACK_SECRET
WEBRTC_RECORDINGS_DIR=$WEBRTC_DIR
ALLOW_VIDEO_GENERATION=1
EOF
  [ -n "$COOKIE_SECURE" ] && echo "COOKIE_SECURE=$COOKIE_SECURE" >> "$INSTALL_DIR/server/.env"
  [ -n "$SETUP_ID" ] && echo "SETUP_ID=$SETUP_ID" >> "$INSTALL_DIR/server/.env"
  [ -n "$ADMIN_REGISTRATION_ENABLED" ] && echo "ADMIN_REGISTRATION_ENABLED=$ADMIN_REGISTRATION_ENABLED" >> "$INSTALL_DIR/server/.env"
  [ -n "$ADMIN_PUBLIC_FEEDS_ENABLED" ] && echo "ADMIN_PUBLIC_FEEDS_ENABLED=$ADMIN_PUBLIC_FEEDS_ENABLED" >> "$INSTALL_DIR/server/.env"
  [ -n "$ADMIN_HOSTNAME" ] && echo "ADMIN_HOSTNAME=$ADMIN_HOSTNAME" >> "$INSTALL_DIR/server/.env"
  [ -n "$DOMAIN" ] && echo "DOMAIN=$DOMAIN" >> "$INSTALL_DIR/server/.env"
  echo "[harborfm-userdata] Wrote server/.env (PM2+webrtc); admin is seeded via db:seedSetup (password never in .env)"
  log_admin_env
  cat > "$INSTALL_DIR/webrtc-service/.env" << EOF
PORT=3002
RTC_MIN_PORT=41000
RTC_MAX_PORT=41100
RECORDING_DATA_DIR=$WEBRTC_DIR
MAIN_APP_URL=http://127.0.0.1:3001
WEBRTC_SERVICE_SECRET=$WEBRTC_SERVICE_SECRET
RECORDING_CALLBACK_SECRET=$RECORDING_CALLBACK_SECRET
MEDIASOUP_ANNOUNCED_IP=$MEDIASOUP_ANNOUNCED_IP
EOF
else
  cat > "$INSTALL_DIR/server/.env" << EOF
NODE_ENV=production
PORT=3001
DATA_DIR=$DATA_DIR
SECRETS_DIR=$SECRETS_DIR
JWT_SECRET=$JWT_SECRET
HARBORFM_SECRETS_KEY=$HARBORFM_SECRETS_KEY
ALLOW_VIDEO_GENERATION=1
EOF
  [ -n "$COOKIE_SECURE" ] && echo "COOKIE_SECURE=$COOKIE_SECURE" >> "$INSTALL_DIR/server/.env"
  [ -n "$SETUP_ID" ] && echo "SETUP_ID=$SETUP_ID" >> "$INSTALL_DIR/server/.env"
  [ -n "$ADMIN_REGISTRATION_ENABLED" ] && echo "ADMIN_REGISTRATION_ENABLED=$ADMIN_REGISTRATION_ENABLED" >> "$INSTALL_DIR/server/.env"
  [ -n "$ADMIN_PUBLIC_FEEDS_ENABLED" ] && echo "ADMIN_PUBLIC_FEEDS_ENABLED=$ADMIN_PUBLIC_FEEDS_ENABLED" >> "$INSTALL_DIR/server/.env"
  [ -n "$ADMIN_HOSTNAME" ] && echo "ADMIN_HOSTNAME=$ADMIN_HOSTNAME" >> "$INSTALL_DIR/server/.env"
  [ -n "$DOMAIN" ] && echo "DOMAIN=$DOMAIN" >> "$INSTALL_DIR/server/.env"
  echo "[harborfm-userdata] Wrote server/.env (PM2); admin is seeded via db:seedSetup (password never in .env)"
  log_admin_env
fi

# Persist secrets for next boot when using data volume (so destroy+apply reuses them)
if [ -z "${PERSISTENT_DATA_EXISTS:-}" ] && [ -n "${JWT_SECRET:-}" ]; then
  mkdir -p "$SECRETS_DIR"
  {
    echo "JWT_SECRET=$JWT_SECRET"
    echo "HARBORFM_SECRETS_KEY=$HARBORFM_SECRETS_KEY"
    [ -n "${WEBRTC_SERVICE_SECRET:-}" ] && echo "WEBRTC_SERVICE_SECRET=$WEBRTC_SERVICE_SECRET"
    [ -n "${RECORDING_CALLBACK_SECRET:-}" ] && echo "RECORDING_CALLBACK_SECRET=$RECORDING_CALLBACK_SECRET"
  } > "$SECRETS_DIR/bootstrap.env"
  chmod 600 "$SECRETS_DIR/bootstrap.env"
fi

# Chown app dirs to harborfm so PM2 runs as non-root
chown -R "$PM2_USER:$PM2_USER" "$INSTALL_DIR" "$DATA_DIR" "$SECRETS_DIR"
[ "$WEBRTC_ENABLED" = "1" ] && chown -R "$PM2_USER:$PM2_USER" "$WEBRTC_DIR"

# Run migrations and one-time seed as harborfm
sudo -u "$PM2_USER" env HOME="/home/$PM2_USER" INSTALL_DIR="$INSTALL_DIR" DATA_DIR="$DATA_DIR" SECRETS_DIR="$SECRETS_DIR" \
  bash -c 'cd "$INSTALL_DIR/server" && export DATA_DIR SECRETS_DIR && set -a && [ -f .env ] && . ./.env && set +a && pnpm run db:migrate'
if [ -n "${ADMIN_EMAIL:-}" ]; then
  echo "[harborfm-userdata] Seeding initial admin (password from ADMIN_PASSWORD_HASH_B64 if set, else use password-reset after first deploy)"
  sudo -u "$PM2_USER" env HOME="/home/$PM2_USER" INSTALL_DIR="$INSTALL_DIR" \
    ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD_HASH_B64="${ADMIN_PASSWORD_HASH_B64:-}" \
    INITIAL_ADMIN_API_TOKEN="${INITIAL_ADMIN_API_TOKEN:-}" \
    bash -c 'cd "$INSTALL_DIR/server" && set -a && [ -f .env ] && . ./.env && set +a && export ADMIN_EMAIL ADMIN_PASSWORD_HASH_B64 INITIAL_ADMIN_API_TOKEN && pnpm run db:seedSetup' || true
fi

# Reverse proxy (nginx or caddy)
if [ "$REVERSE_PROXY" = "caddy" ]; then
  mkdir -p /var/log/caddy
  write_caddy_harborfm_conf /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile
else
  # certbot or self-signed for PM2+nginx
  CERTBOT_PM2=false
  SELF_SIGNED_PM2=false
  [ -n "$CERTBOT_EMAIL" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && CERTBOT_PM2=true
  [ "$CERTBOT_PM2" = "false" ] && [ "$SELF_SIGNED_CERT" = "1" ] && [ -n "$DOMAIN" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && SELF_SIGNED_PM2=true
  # Stop any service already using port 80 (httpd on RHEL, apache2 on Debian)
  if [ "$IS_ALPINE" = "true" ]; then
    stop_svc apache2 2>/dev/null || true
    disable_svc apache2 2>/dev/null || true
  else
    systemctl stop httpd 2>/dev/null || true
    systemctl disable httpd 2>/dev/null || true
    systemctl stop apache2 2>/dev/null || true
    systemctl disable apache2 2>/dev/null || true
  fi
  if $IS_DEB; then
    NGINX_CONF="/etc/nginx/sites-available/harborfm"
  else
    NGINX_CONF="/etc/nginx/conf.d/harborfm.conf"
  fi
  mkdir -p /var/www/certbot
  # SELinux (CentOS/RHEL): allow nginx to read certbot webroot for ACME challenge
  chcon -R -t httpd_sys_content_t /var/www/certbot 2>/dev/null || true
  # server_tokens: in our server block to avoid duplicate with Ubuntu 25+ / other distro defaults
  if $CERTBOT_PM2; then
    SERVER_NAME="$DOMAIN"
    LISTEN_80="listen 80;"
    LISTEN_80V6="listen [::]:80;"
  else
    SERVER_NAME="_"
    LISTEN_80="listen 80 default_server;"
    LISTEN_80V6="listen [::]:80 default_server;"
  fi
  write_nginx_harborfm_conf "$NGINX_CONF" http
  if $IS_DEB; then
    rm -f /etc/nginx/sites-enabled/default
    ln -sf /etc/nginx/sites-available/harborfm /etc/nginx/sites-enabled/
  else
    rm -f /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default /etc/nginx/conf.d/localhost.conf 2>/dev/null || true
    # SELinux: allow nginx to proxy to backend (127.0.0.1:3001)
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
  fi
  nginx -t && ( svc_running nginx && reload_svc nginx || start_svc nginx )
fi

# PM2: run as harborfm from INSTALL_DIR (unset PORT so webrtc doesn't inherit server's 3001)
sudo -u "$PM2_USER" env HOME="/home/$PM2_USER" INSTALL_DIR="$INSTALL_DIR" WEBRTC_ENABLED="$WEBRTC_ENABLED" \
  ADMIN_EMAIL="${ADMIN_EMAIL:-}" EMAIL_PROVIDER="${EMAIL_PROVIDER:-}" EMAIL_WEBHOOK_URL="${EMAIL_WEBHOOK_URL:-}" \
  bash -c 'unset PORT; cd "$INSTALL_DIR" && (
    if pm2 describe harborfm &>/dev/null; then
      [ "$WEBRTC_ENABLED" = "1" ] && pm2 reload ecosystem.config.cjs --update-env || pm2 reload ecosystem.config.cjs --only harborfm --update-env
    else
      [ "$WEBRTC_ENABLED" = "1" ] && pm2 start ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs --only harborfm --update-env
    fi
  )'
# Wait for server to bind to 3001 (handles slow first-start, e.g. DB init)
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  curl -s -o /dev/null --connect-timeout 2 http://127.0.0.1:3001/ 2>/dev/null && break
  [ "$i" -eq 10 ] && sudo -u "$PM2_USER" env HOME="/home/$PM2_USER" bash -c "cd $INSTALL_DIR && pm2 restart harborfm --update-env" || true
done
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD_HASH:-}" ]; then
  echo "[harborfm-userdata] Server is up. If initial admin was not created, check PM2 logs: sudo -u $PM2_USER pm2 logs harborfm --lines 100 (look for [setup] bootstrap)"
fi
# When admin was seeded and email is webhook, send admin the welcome/set-password email
if [ -n "${ADMIN_EMAIL:-}" ] && [ "${EMAIL_PROVIDER:-}" = "webhook" ] && [ -n "${EMAIL_WEBHOOK_URL:-}" ]; then
  echo "[harborfm-userdata] Sending seed admin welcome/set-password email via webhook"
  sudo -u "$PM2_USER" env HOME="/home/$PM2_USER" INSTALL_DIR="$INSTALL_DIR" ADMIN_EMAIL="$ADMIN_EMAIL" \
    bash -c 'cd "$INSTALL_DIR/server" && set -a && [ -f .env ] && . ./.env && set +a && export ADMIN_EMAIL && pnpm run send-seed-admin-welcome' || true
fi
sudo -u "$PM2_USER" env HOME="/home/$PM2_USER" bash -c "cd $INSTALL_DIR && pm2 save"
# pm2 startup must run as root to install init service; -u/--hp target harborfm's PM2
if [ "$IS_ALPINE" = "true" ]; then
  pm2 startup openrc -u "$PM2_USER" --hp "/home/$PM2_USER" 2>/dev/null || true
else
  pm2 startup systemd -u "$PM2_USER" --hp "/home/$PM2_USER" 2>/dev/null || true
fi

if [ "$REVERSE_PROXY" = "caddy" ]; then
  enable_svc caddy
  restart_svc caddy
else
  enable_svc nginx
  restart_svc nginx
fi

# fail2ban
mkdir -p /etc/fail2ban/filter.d /etc/fail2ban/jail.d
# SSH jail (built-in sshd filter)
if [ -f /var/log/auth.log ]; then
  SSH_LOG=/var/log/auth.log
else
  SSH_LOG=/var/log/secure
fi
cat > /etc/fail2ban/jail.d/sshd.local << F2B_SSHD
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = $SSH_LOG
maxretry = 5
findtime = 10m
bantime = 1h
F2B_SSHD
if [ "$REVERSE_PROXY" = "caddy" ]; then
  curl -fsSL "$BASE_URL/fail2ban/filter.d/caddy-scanner.conf" -o /etc/fail2ban/filter.d/caddy-scanner.conf
  cat > /etc/fail2ban/jail.d/caddy-scanner.local << 'F2B_EOF'
[caddy-scanner]
enabled = true
port = http,https
filter = caddy-scanner
logpath = /var/log/caddy/access.log
maxretry = 1
findtime = 1d
bantime = 30m
chain = INPUT
action = iptables-multiport[name=caddy-scanner, port="80,443", protocol=tcp, chain=INPUT]
F2B_EOF
else
  curl -fsSL "$BASE_URL/fail2ban/filter.d/nginx-scanner.conf" -o /etc/fail2ban/filter.d/nginx-scanner.conf
  cat > /etc/fail2ban/jail.d/nginx-scanner.local << 'F2B_EOF'
[nginx-scanner]
enabled = true
port = http,https
filter = nginx-scanner
logpath = /var/log/nginx/access.log
maxretry = 1
findtime = 1d
bantime = 30m
chain = INPUT
action = iptables-multiport[name=nginx-scanner, port="80,443", protocol=tcp, chain=INPUT]
F2B_EOF
fi
enable_svc fail2ban
restart_svc fail2ban

# certbot or self-signed for PM2+nginx: switch to HTTPS
CERT_DIR=""
if [ "${CERTBOT_PM2}" = "true" ] && command -v certbot &>/dev/null; then
  sleep 5
  if certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$CERTBOT_EMAIL" --non-interactive --agree-tos 2>/dev/null; then
    CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
    if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
      write_nginx_harborfm_conf "$NGINX_CONF" https "$CERT_DIR" 1
      nginx -t && reload_svc nginx
    fi
  fi
elif [ "${SELF_SIGNED_PM2}" = "true" ]; then
  SSL_DIR="/etc/nginx/ssl"
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$SSL_DIR/privkey.pem" \
    -out "$SSL_DIR/fullchain.pem" \
    -subj "/CN=${DOMAIN}/O=HarborFM" 2>/dev/null
  CERT_DIR="$SSL_DIR"
  if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    write_nginx_harborfm_conf "$NGINX_CONF" https "$CERT_DIR" 0
    nginx -t && reload_svc nginx
    echo "HarborFM (PM2) with self-signed HTTPS at https://${DOMAIN}/"
  fi
fi

PM2_SCHEME="http"
[ "$REVERSE_PROXY" = "caddy" ] && [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "_" ] && PM2_SCHEME="https"
[ -n "${CERT_DIR:-}" ] && PM2_SCHEME="https"
echo "HarborFM (PM2) ready at ${PM2_SCHEME}://$(curl -s ifconfig.me 2>/dev/null || echo localhost)/"
echo "PM2 runs as $PM2_USER; to see processes: sudo -u $PM2_USER pm2 list"
