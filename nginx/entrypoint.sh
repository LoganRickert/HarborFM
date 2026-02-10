#!/bin/sh
set -e

DOMAIN="${DOMAIN:-localhost}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
CERT_PATH="${CERT_DIR}/fullchain.pem"
KEY_PATH="${CERT_DIR}/privkey.pem"

# Ensure log files are real files (not symlinks to /dev/stdout) so fail2ban can read them
LOG_DIR="/var/log/nginx"
for log in access.log error.log; do
  if [ -L "${LOG_DIR}/${log}" ] || [ ! -f "${LOG_DIR}/${log}" ]; then
    rm -f "${LOG_DIR}/${log}"
    touch "${LOG_DIR}/${log}"
  fi
done

write_config() {
  if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
    envsubst '${DOMAIN}' < /etc/nginx/nginx-full.conf.template > /etc/nginx/nginx.conf
  else
    envsubst '${DOMAIN}' < /etc/nginx/nginx-80-only.conf.template > /etc/nginx/nginx.conf
  fi
}

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
