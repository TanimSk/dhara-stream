# Deploying dhara on one small VPS

Target: Ubuntu 24.04, 1 vCPU / 2 GB, nginx + Postgres + gunicorn. Two hostnames point at it:
`dhara.app` (landing, dashboards, API) and `play.dhara.app` (player + playback gate).

## 1. Cloudflare
1. Create an API token with **Account › Workers R2 Storage › Edit** and **Account › Account API
   Tokens › Edit** on your account. Note the account ID.
2. Enable R2 on the account. Buckets are created per client from the master admin portal.

## 2. Server
```bash
adduser --system --group dhara
apt install nginx postgresql python3-venv certbot python3-certbot-nginx
sudo -u postgres createuser dhara && sudo -u postgres createdb -O dhara dhara_stream
cp deploy/postgresql-dhara.conf /etc/postgresql/*/main/conf.d/dhara.conf && systemctl restart postgresql

git clone https://github.com/TanimSk/dhara-stream /srv/dhara && chown -R dhara /srv/dhara
cd /srv/dhara/backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env    # then edit, see below
.venv/bin/python manage.py migrate
.venv/bin/python manage.py collectstatic --noinput
.venv/bin/python manage.py createsuperuser     # your master admin login
```

`backend/.env` in production:
```
DEBUG=false
SECRET_KEY=<long random>
FERNET_KEY=<Fernet.generate_key()>   # back this up: it decrypts every stored secret and content key
ALLOWED_HOSTS=dhara.app,play.dhara.app
CSRF_TRUSTED_ORIGINS=https://dhara.app
DB_NAME=dhara_stream
DB_USER=dhara
DASHBOARD_ORIGIN=https://dhara.app
PLAYER_ORIGIN=https://play.dhara.app
CF_ACCOUNT_ID=…
CF_API_TOKEN=…
SECURE_HSTS_SECONDS=31536000
```

## 3. Web build
Build locally or on the server (Node 20+):
```bash
cd web && npm ci && npm run build      # → web/dist, served by nginx
```

## 4. nginx + systemd
```bash
cp deploy/dhara_proxy.conf /etc/nginx/ && cp deploy/nginx.conf /etc/nginx/sites-available/dhara
ln -s /etc/nginx/sites-available/dhara /etc/nginx/sites-enabled/ && certbot --nginx -d dhara.app -d play.dhara.app
cp deploy/dhara.service /etc/systemd/system/ && systemctl enable --now dhara && systemctl reload nginx
crontab -e   # 15 3 * * * /srv/dhara/deploy/backup.sh
```

## 5. Desktop app
```bash
cd desktop && npm ci
DHARA_API_BASE=https://dhara.app DHARA_PLAYER_ORIGIN=https://play.dhara.app npm run dist:mac   # or dist:win on Windows
```
Installers land in `desktop/release/`. Code-sign them before distributing (Apple Developer ID +
notarization, Windows Authenticode), otherwise macOS Gatekeeper and SmartScreen warn users.

## Updating
```bash
cd /srv/dhara && git pull && cd backend && .venv/bin/pip install -r requirements.txt \
  && .venv/bin/python manage.py migrate && .venv/bin/python manage.py collectstatic --noinput \
  && systemctl restart dhara && (cd ../web && npm ci && npm run build)
```

## What to watch
- `journalctl -u dhara -f`: app logs. `GET https://play.dhara.app/health` returns `ok`.
- Load is tiny: about 4 small requests per play (embed, master, variant, key). Video bytes are served
  by Cloudflare R2 directly, with free egress.
- **Back up `FERNET_KEY` and the database.** Segments in R2 are useless without the content keys stored in Postgres.
