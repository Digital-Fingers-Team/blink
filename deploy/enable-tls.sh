#!/usr/bin/env bash
# Issue the Let's Encrypt certificate for blink.pricelens.work.gd and switch the proxy to TLS.
# Mirrors ~/pricelens/scripts/renew-cert.sh (webroot challenge through the pricelens nginx container);
# the existing renew job then keeps this certificate fresh too.
set -euo pipefail
HOST=blink.pricelens.work.gd
ROOT="$HOME/pricelens"
CONF="$ROOT/docker/certbot/conf"
UPSTREAM="host.containers.internal:8790"

if ! getent hosts "$HOST" >/dev/null; then echo "DNS for $HOST does not resolve yet"; exit 2; fi

if [[ ! -f "$CONF/live/$HOST/fullchain.pem" ]]; then
  docker run --rm \
    -v "$CONF:/etc/letsencrypt:z" \
    -v "$ROOT/docker/certbot/www:/var/www/certbot:z" \
    docker.io/certbot/certbot:latest certonly --webroot -w /var/www/certbot \
    -d "$HOST" --non-interactive --agree-tos --no-eff-email --keep-until-expiring \
    $( [[ -d "$CONF/accounts" ]] && echo "" || echo "--register-unsafely-without-email" )  # reuse the existing ACME account
fi

cat > "$ROOT/docker/nginx-upstreams/blink.conf" <<EOF
# BLINK — SPHEREx Time Machine (NASA Space Apps 2026). Runs on the host under pm2 (port 8790).
server {
    listen 80;
    server_name $HOST;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name $HOST;

    ssl_certificate     /etc/letsencrypt/live/$HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$HOST/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;

    # Cutouts are binary blobs up to ~260 KB; compress the text side only.
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://$UPSTREAM;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF

docker exec pricelens-proxy nginx -t
docker exec pricelens-proxy nginx -s reload
echo "https://$HOST is live"
