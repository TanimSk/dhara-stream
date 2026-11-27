# dhara

Private video hosting: per-client R2 storage, on-device transcoding, encrypted HLS, and a
domain-locked embeddable player, all on one small VPS.

- **Master admin** creates clients. Each client gets its own Cloudflare R2 bucket automatically.
- **Clients** upload from the **desktop app**, which compresses into the qualities they pick (480p,
  720p, 1080p…), or from the **web dashboard**, which re-packages the file without compression. They
  organize videos into categories and set each video or category public or private.
- **Viewers** watch through the dhara player embedded on the client's website. The player works only
  on allowed domains, and private videos need a short-lived token signed by the client's server.

The VPS only gates playback. Video bytes go from R2 straight to viewers. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Develop
```bash
bin/setup     # once: Python venv, npm installs, Postgres database, backend/.env
bin/dev       # Django :8000 (API + player), Vite :5173 (dashboard)
```
Create the first master admin:
```bash
backend/.venv/bin/python backend/manage.py createsuperuser
```
Desktop app: `cd desktop && npm run dev` (uses the dev servers above).

## Test
```bash
cd backend && .venv/bin/pytest
cd web && npm run typecheck
```

## Deploy
See [`deploy/README.md`](deploy/README.md).
