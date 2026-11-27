# dhara architecture

dhara hosts videos for clients. A master admin creates clients, and each client gets its own
Cloudflare R2 bucket. Clients upload and organize videos from a desktop app (which transcodes
locally) or from the web dashboard. Viewers watch through an embeddable player that is locked to
the client's domains.

## Principles
1. **The VPS is a gate, not a pipe.** It answers small text requests (the player page, playlists and
   the 16-byte key). Video bytes go from R2 straight to the viewer with presigned URLs, and R2 egress
   is free.
2. **Transcoding runs on the client's machine.** The desktop app runs ffmpeg and the browser runs
   ffmpeg.wasm (remux only). The server never decodes video.
3. **Encrypted at rest and in transit.** Segments are AES-128 encrypted before upload. Only the gate
   serves the key, and only within a valid playback session. A leaked segment URL gives you
   encrypted bytes.
4. **R2 credentials never leave the server.** Uploaders and players only ever receive presigned URLs.
5. **Small footprint.** One VPS (1 vCPU / 2 GB) runs nginx, gunicorn (3 workers) and Postgres. There
   is no Redis, no Celery and no Node server.

## Components
| Path | What |
|---|---|
| `backend/` | Django 5 + DRF: auth, master admin API, client API, upload flow, playback gate |
| `web/` | Vite + React + TS + Tailwind v4: landing page, master admin portal, client dashboard (static build) |
| `desktop/` | Electron shell around the same web UI, adding bundled ffmpeg transcoding and resumable parallel upload |
| `deploy/` | nginx, systemd, Postgres tuning, backup, runbook |

## Hosts
| Origin | Served by | Paths |
|---|---|---|
| `DASHBOARD_ORIGIN` (e.g. `https://dhara.app`) | nginx static + `/api/` → gunicorn | landing, `/login`, `/admin/*`, `/app/*`, `/api/v1/*` |
| `PLAYER_ORIGIN` (e.g. `https://play.dhara.app`) | nginx → gunicorn | `/embed/*`, `/v/*`, `/static/hls.min.js` |
| `https://<account>.r2.cloudflarestorage.com/<bucket>/…` | Cloudflare R2 | segments, thumbnails, MP4s (presigned only) |

The player has its own origin, so it carries no dashboard cookies, and each bucket's CORS only
admits the player and dashboard origins.

## Data model
- `User`: role is `master` or `client`. A client user belongs to exactly one `Client`. There is no self-signup.
- `Client`: name, status (`active` | `suspended`), `allowed_domains[]` (exact or `*.wildcard`),
  `allow_direct`, `api_key_id` (public), `api_secret` (encrypted; signs playback tokens).
- `R2Bucket` (1:1 with Client): name, account id, bucket-scoped S3 credentials (secret encrypted),
  CF token id, status (`provisioning` | `ready` | `failed`), `manual`.
- `Category`: name, visibility.
- `Video` (UUID): title, category, visibility, status (`uploading` | `ready` | `failed`), source
  (`hls` | `mp4`), renditions, validated variant playlists (stored in Postgres, not fetched from R2),
  `aes_key` (encrypted), thumbnail flag.
  - A video is **private** when it or its category is private.

## R2 layout (per client bucket)
```
<video-uuid>/thumb.jpg
<video-uuid>/<h>p/index.m3u8          backup copy; the gate serves the DB copy
<video-uuid>/<h>p/seg_00000.ts        MPEG-TS, AES-128 (key URI "dhara-key")
<video-uuid>/video.mp4                MP4 fallback for web uploads
```

## Upload flow
1. `POST /api/v1/videos` with `{title, category, visibility, source, uploaded_via}` returns `video` and
   `upload: {key_hex, key_uri: "dhara-key", segment_seconds: 6}`.
2. The uploader encrypts with ffmpeg: `-hls_key_info_file` containing `dhara-key`, the key file and an IV.
   - Desktop: one rendition per selected quality ≤ the source height.
   - Web: a single rendition, `-c copy` remux.
3. `POST /api/v1/videos/<id>/upload-urls` with `{files: ["720p/seg_00000.ts", …]}` (≤ 200 per call)
   returns presigned PUT URLs, valid for 6 h. Allowed paths are whitelisted by regex.
4. The uploader PUTs files straight to R2, several in parallel, retrying per file.
5. `POST /api/v1/videos/<id>/complete` sends `{duration, width, height, size_bytes, has_thumbnail,
   renditions: [{height, width, bandwidth, codecs, playlist}]}`.
   - The server validates every playlist strictly: only `seg_NNNNN.ts` lines, only the `dhara-key` key
     URI, VOD with ENDLIST.
   - It HEADs the last segment of each rendition, then marks the video `ready`.
6. `GET /api/v1/videos/<id>/upload-key` re-issues the key while the video is still uploading (to resume).
7. `POST /api/v1/videos/<id>/fail` marks the video failed.

## Playback
```
viewer page (client site) ──iframe──> PLAYER/embed/<id>[?token=&exp=]
  1. video ready, client active, bucket ready
  2. Origin/Referer host ∈ allowed_domains ∪ {player, dashboard}; no header → only if allow_direct
  3. private → token = base64url(HMAC_SHA256(api_secret, "<id>:<exp>")), exp in future, ≤ 7 days
  4. render player with session S (Django-signed {v, h}, valid 4 h)
     headers: CSP frame-ancestors <allowed domains>, Referrer-Policy same-origin, no-store
hls.js ─> PLAYER/v/S/master.m3u8   built from renditions
hls.js ─> PLAYER/v/S/<h>.m3u8      segment lines → presigned GET (6 h, signed per hour window, cached)
hls.js ─> PLAYER/v/S/key           16-byte AES key
hls.js ─> R2 presigned segment     encrypted bytes, straight from Cloudflare
```
- `/v/*` refuses any foreign Origin/Referer. It sends no CORS headers, so other sites' scripts can't
  read playlists or keys.
- Suspending a client stops new embeds and every live session's playlist/key requests immediately.
- The MP4 fallback `/v/S/video.mp4` returns a 302 to a presigned GET.

### Client integration (on the client's server)
```js
// Node
const exp = Math.floor(Date.now() / 1000) + 2 * 3600;
const token = crypto.createHmac("sha256", process.env.DHARA_SECRET)
  .update(`${videoId}:${exp}`).digest("base64url");
const src = `https://play.dhara.app/embed/${videoId}?token=${token}&exp=${exp}`;
```
Alternatively, call `POST /api/v1/playback-token` with `Authorization: ApiKey <key_id>:<secret>` and
`{video_id, ttl}`.

## API summary (`/api/v1`, JSON, `{"success", "message", …}`)
| Who | Endpoints |
|---|---|
| anyone | `POST auth/login {email,password,device:"web"|"desktop"}`, `POST auth/refresh`, `POST auth/logout` |
| signed in | `GET auth/me`, `POST auth/password` |
| master | `GET admin/overview`, `GET/POST admin/clients`, `GET/PATCH/DELETE admin/clients/<id>`, `POST admin/clients/<id>/provision`, `PUT admin/clients/<id>/bucket`, `POST admin/clients/<id>/reset-password` |
| client | `GET/PATCH account`, `GET account/api-key`, `POST account/api-key/rotate`, `GET/POST categories`, `PATCH/DELETE categories/<id>`, `GET/POST videos`, `GET/PATCH/DELETE videos/<id>`, `GET videos/<id>/upload-key`, `POST videos/<id>/upload-urls`, `POST videos/<id>/complete`, `POST videos/<id>/fail`, `GET videos/<id>/embed` |
| API key | `POST playback-token` |

Web auth keeps the refresh token in an httpOnly SameSite=Strict cookie on `/api/v1/auth/`, and the
access token in memory. The desktop app sends `device: "desktop"`, receives the refresh token in the
body, and stores it in the OS keychain (Electron `safeStorage`).

## Bucket provisioning (master admin → Cloudflare API)
Creating a client creates the client login, then:
1. `POST /accounts/<acct>/r2/buckets` creates `dhara-<slug>`.
2. `PUT …/cors` lets the player and dashboard GET/HEAD, and the dashboard PUT.
3. `POST /accounts/<acct>/tokens` creates a token scoped to that bucket with "Workers R2 Storage Bucket Item
   Write". The S3 key id is the token id, and the secret is sha256(token value).

If Cloudflare isn't configured or a step fails, the bucket shows `failed` with the reason. The admin
can retry, or paste credentials manually.

## Threat notes
- Embedding on an unlisted site fails on both the iframe (CSP frame-ancestors) and the gate's Referer
  check.
- A copied embed link fails with no Referer (unless `allow_direct`). For private videos it also fails
  once the token expires.
- Copied playlist or key URLs work only within the 4 h session and never from another site's page.
  A copied segment URL yields only encrypted bytes.
- Spoofed headers (curl) can still fetch a public video's stream. HLS AES-128 is not DRM. It raises
  the bar but can't stop a determined ripper who also runs the player.
