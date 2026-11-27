#!/usr/bin/env bash
# One-time root setup for dhara on hypernode. Run:  sudo bash ~/dhara-stream/deploy/hypernode/setup.sh
# Every step is idempotent and prints what it does.
set -euo pipefail
APP=/home/hypernode/dhara-stream
ENV=$APP/backend/.env
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

step "1/7 Swap: add a 2 GB /swapfile2 (existing 1 GB /swapfile stays)"
if ! swapon --show | grep -q /swapfile2; then
  fallocate -l 2G /swapfile2 && chmod 600 /swapfile2 && mkswap /swapfile2 >/dev/null && swapon /swapfile2
  grep -q '^/swapfile2 ' /etc/fstab || echo '/swapfile2 none swap sw 0 0' >> /etc/fstab
fi
swapon --show

step "2/7 coturn: stop, disable and remove the package (/etc/turnserver.conf is kept)"
if dpkg -s coturn >/dev/null 2>&1; then
  systemctl disable --now coturn || true
  apt-get remove -y coturn
else
  echo "coturn already removed"
fi

step "3/7 Postgres: role 'dhara' + database 'dhara_stream'"
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV" | cut -d= -f2-)
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dhara') THEN
    CREATE ROLE dhara LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE dhara PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname='dhara_stream'" | grep -q 1 \
  || sudo -u postgres createdb -O dhara dhara_stream
echo "ok"

step "4/7 Public files: /srv/dhara (owned by hypernode, readable by nginx)"
mkdir -p /srv/dhara/web /srv/dhara/static
chown -R hypernode:www-data /srv/dhara && chmod -R 755 /srv/dhara
sudo -u hypernode cp -a "$APP/web-dist/." /srv/dhara/web/
sudo -u hypernode bash -c "cd $APP/backend && .venv/bin/python manage.py collectstatic --noinput -v0 && .venv/bin/python manage.py migrate --noinput -v0"
echo "ok"

step "5/7 systemd: dhara.service (2 gunicorn workers on 127.0.0.1:8830, capped at 400 MB)"
cp "$APP/deploy/hypernode/dhara.service" /etc/systemd/system/dhara.service
systemctl daemon-reload && systemctl enable --now dhara && systemctl restart dhara
sleep 3 && curl -fsS -H 'Host: dhara-play.2devs.net' http://127.0.0.1:8830/health && echo " ← gunicorn healthy"
grep -q '^gunicorn:dhara' /opt/nightly-recycle/services.conf 2>/dev/null \
  || sed -i 's#^nginx:nginx#gunicorn:dhara:http://127.0.0.1:8830/health\nnginx:nginx#' /opt/nightly-recycle/services.conf

step "6/7 nginx: dhara.2devs.net + dhara-play.2devs.net"
cp "$APP/deploy/hypernode/nginx-dhara.conf" /etc/nginx/sites-available/dhara.2devs.net
cp "$APP/deploy/dhara_proxy.conf" /etc/nginx/dhara_proxy.conf
ln -sf /etc/nginx/sites-available/dhara.2devs.net /etc/nginx/sites-enabled/dhara.2devs.net
nginx -t && systemctl reload nginx

step "7/7 TLS: Let's Encrypt for both hostnames (DNS must already point here)"
certbot --nginx -d dhara.2devs.net -d dhara-play.2devs.net --redirect --non-interactive --agree-tos \
  --cert-name dhara.2devs.net || echo "!! certbot failed: check the DNS A records, then re-run this script"

printf '\n\033[1mDone.\033[0m  https://dhara.2devs.net  ·  https://dhara-play.2devs.net/health\n'
free -h
