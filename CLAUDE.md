# dhara

Video hosting: Django gate on a small VPS, presigned R2 handoff, AES-128 HLS, on-device transcoding.
Read `docs/ARCHITECTURE.md` before changing architecture.

## Layout
- `backend/`: Django + DRF in DRFBoilerplate style:
  - class-based `APIView`s;
  - `{"success", "message", ...}` envelopes via `utils.shared.ok/fail`;
  - `utils.shared.custom_exception_handler`;
  - `utils.shared.paginate`.
  - Apps: `administrator` (User, auth, master admin API), `clients` (Client, R2Bucket, provisioning,
    API key), `library` (Category, Video, upload flow, `hls.py`), `playback` (gate + player page).
- `web/`: Vite + React + TS + Tailwind v4. Design tokens in `src/index.css`, UI kit in
  `src/components/ui.tsx`.
  - Keep the white-matte Apple/Claude look: near-black pill buttons, Instrument Serif for display
    headlines only, clay accent used sparingly.
- `desktop/`: Electron. Loads the `web/` build and exposes `window.dharaDesktop` (ffmpeg probe/transcode,
  uploads, keychain).
- `backend/playback/pages/player.html` is generated from dhara-old's liquid-glass player. Keep the look identical.

## Rules
- Every client endpoint filters by `request.client` (set by `IsClientUser`). Add a cross-client test
  for each new endpoint.
- Video bytes never touch Django. Hand out presigned URLs (`utils/r2.py`) only.
- Secrets come only from env vars, and stored secrets use `EncryptedTextField`. Never log keys or
  tokens.
- Playlists from uploaders go through `library.hls.validate_variant`. Don't loosen it.

## Tests
- `cd backend && .venv/bin/pytest`
- `cd web && npm run typecheck`
