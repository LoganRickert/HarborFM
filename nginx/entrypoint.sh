#!/bin/sh
set -e

DOMAIN="${DOMAIN:-localhost}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
CERT_PATH="${CERT_DIR}/fullchain.pem"
KEY_PATH="${CERT_DIR}/privkey.pem"
WEBRTC_ENABLED="${WEBRTC_ENABLED:-0}"

# Ensure log files are real files (not symlinks to /dev/stdout) so fail2ban can read them
LOG_DIR="/var/log/nginx"
for log in access.log error.log; do
  if [ -L "${LOG_DIR}/${log}" ] || [ ! -f "${LOG_DIR}/${log}" ]; then
    rm -f "${LOG_DIR}/${log}"
    touch "${LOG_DIR}/${log}"
  fi
done

# WebRTC location: proxy when enabled, 503 when disabled (avoids nginx failing when webrtc container is not running)
write_webrtc_include() {
  if [ "$WEBRTC_ENABLED" = "1" ]; then
    cat > /etc/nginx/webrtc-ws.inc << 'NGINX_EOF'
        location /webrtc-ws/ {
            proxy_pass http://webrtc:3002/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }
NGINX_EOF
  else
    cat > /etc/nginx/webrtc-ws.inc << 'NGINX_EOF'
        location /webrtc-ws/ {
            add_header Content-Type text/plain;
            return 503 "WebRTC service is disabled";
        }
NGINX_EOF
  fi
}

write_config() {
  if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
    envsubst '${DOMAIN}' < /etc/nginx/nginx-full.conf.template > /etc/nginx/nginx.conf
  else
    envsubst '${DOMAIN}' < /etc/nginx/nginx-80-only.conf.template > /etc/nginx/nginx.conf
  fi
}

write_webrtc_include
export DOMAIN
write_config

# Start nginx in background so we can run reload loop
nginx -g "daemon off;" &
NGINX_PID=$!

# When certbot adds certs, switch to full config and reload
LAST_MTIME=""
while kill -0 $NGINX_PID 2>/dev/null; do
  if [ -f "$CERT_PATH" ]; then
    MTIME=$(stat -c %Y "$CERT_PATH" 2>/dev/null || true)
    if [ -n "$MTIME" ] && [ "$MTIME" != "$LAST_MTIME" ]; then
      if [ -n "$LAST_MTIME" ]; then
        echo "Certificate updated; switching to HTTPS config and reloading nginx"
      fi
      write_config
      nginx -s reload 2>/dev/null || true
      LAST_MTIME="$MTIME"
    fi
  fi
  sleep 60
done

exit 1
