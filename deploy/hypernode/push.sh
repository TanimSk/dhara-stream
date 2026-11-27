#!/usr/bin/env bash
# Deploy/update from this machine: ./deploy/hypernode/push.sh
# Builds the dashboard locally (the server's Node is too old), syncs code, installs deps, migrates, reloads.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST=${HOST:-hypernode}
APP=/home/hypernode/dhara-stream

(cd web && npm run build >/dev/null) && echo "✓ web built"
rsync -az --delete --exclude .venv --exclude .env --exclude __pycache__ --exclude staticfiles --exclude .pytest_cache \
  backend deploy "$HOST:$APP/"
rsync -az --delete web/dist/ "$HOST:$APP/web-dist/"
echo "✓ synced"

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
cd $APP/backend
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip >/dev/null
.venv/bin/pip install -q -r requirements.txt
if [ ! -f .env ]; then   # first deploy: secrets are generated here and never leave the server
  gen() { .venv/bin/python -c "\$1"; }
  umask 077
  cat > .env <<ENVFILE
DEBUG=false
SECRET_KEY=\$(gen 'import secrets; print(secrets.token_urlsafe(50))')
FERNET_KEY=\$(gen 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')
ALLOWED_HOSTS=dhara.2devs.net,dhara-play.2devs.net,127.0.0.1
DB_NAME=dhara_stream
DB_USER=dhara
DB_PASSWORD=\$(gen 'import secrets; print(secrets.token_urlsafe(24))')
DB_HOST=127.0.0.1
DB_PORT=5432
DASHBOARD_ORIGIN=https://dhara.2devs.net
PLAYER_ORIGIN=https://dhara-play.2devs.net
DESKTOP_ORIGIN=app://dhara
STATIC_ROOT=/srv/dhara/static
SECURE_HSTS_SECONDS=31536000
# Cloudflare: fill these in, then: sudo systemctl restart dhara
CF_ACCOUNT_ID=
CF_API_TOKEN=
R2_BUCKET_PREFIX=dhara-
ENVFILE
  echo "✓ .env created with fresh secrets"
fi
if [ -d /srv/dhara/web ]; then   # after the one-time sudo setup
  .venv/bin/python manage.py migrate --noinput -v0
  .venv/bin/python manage.py collectstatic --noinput -v0
  rsync -a --delete $APP/web-dist/ /srv/dhara/web/
  systemctl is-active --quiet dhara && kill -HUP \$(systemctl show -p MainPID --value dhara) && echo "✓ gunicorn reloaded"
fi
.venv/bin/python manage.py check --deploy 2>&1 | grep -vE "^System check|W008|^$" || true
REMOTE
echo "✓ deployed"
