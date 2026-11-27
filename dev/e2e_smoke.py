#!/usr/bin/env python3
"""
End-to-end smoke test against a running `bin/dev` stack (fake R2 + Django).

Transcodes a generated clip into two encrypted HLS qualities with ffmpeg (exactly like the desktop
app), uploads via presigned URLs, completes, then plays it through the gate and checks:
domain lock, token, playlist rewrite, key delivery, and that a raw segment is ciphertext that the
gate's key decrypts.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

API = os.getenv("DHARA_API", "http://localhost:5173/api/v1")
PLAYER = os.getenv("DHARA_PLAYER", "http://localhost:8000")
EMAIL, PASSWORD = os.getenv("DHARA_EMAIL", "demo@dhara.local"), os.getenv("DHARA_PASSWORD", "dhara-dev-123")


def req(method, url, body=None, headers=None, raw=False):
    data = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    h = {"Content-Type": "application/json"} if isinstance(body, (dict, list)) else {}
    h.update(headers or {})
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r) as resp:
            content = resp.read()
            return resp.status, (content if raw else json.loads(content or b"{}")), resp.headers
    except urllib.error.HTTPError as e:
        content = e.read()
        return e.code, (content if raw else json.loads(content or b"{}")), e.headers


def ok(cond, msg):
    print(("  ✓ " if cond else "  ✗ ") + msg)
    if not cond:
        sys.exit(1)


def main():
    work = Path(tempfile.mkdtemp(prefix="dhara-e2e-"))
    print(f"work dir {work}")

    st, d, _ = req("POST", f"{API}/auth/login", {"email": EMAIL, "password": PASSWORD, "device": "desktop"})
    ok(st == 200, "login")
    auth = {"Authorization": f"Bearer {d['access']}"}

    st, d, _ = req("POST", f"{API}/videos", {"title": f"E2E {int(time.time())}", "visibility": "private"}, auth)
    ok(st == 201, "create video")
    vid, up = d["video"]["id"], d["upload"]

    # --- transcode like the desktop app: AES-128 via -hls_key_info_file ---
    src = work / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi",
                    "-i", "sine=frequency=440", "-t", "14", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(src)], check=True)
    keyfile = work / "enc.key"
    keyfile.write_bytes(bytes.fromhex(up["key_hex"]))
    iv = os.urandom(16).hex()
    (work / "keyinfo").write_text(f"{up['key_uri']}\n{keyfile}\n{iv}\n")
    renditions = []
    for h, w, br in [(720, 1280, "2500k"), (360, 640, "700k")]:
        out = work / f"{h}p"
        out.mkdir()
        subprocess.run([
            "ffmpeg", "-v", "error", "-i", str(src), "-vf", f"scale=-2:{h}", "-c:v", "libx264", "-b:v", br,
            "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "128k",
            "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_key_info_file", str(work / "keyinfo"),
            "-hls_segment_filename", str(out / "seg_%05d.ts"), str(out / "index.m3u8"),
        ], check=True)
        renditions.append({"height": h, "width": w, "bandwidth": int(br[:-1]) * 1000 + 128000,
                           "codecs": "avc1.64001f,mp4a.40.2", "playlist": (out / "index.m3u8").read_text()})
    subprocess.run(["ffmpeg", "-v", "error", "-ss", "2", "-i", str(src), "-frames:v", "1", "-q:v", "4", str(work / "thumb.jpg")], check=True)

    files = sorted(str(p.relative_to(work)) for p in work.rglob("*") if p.suffix in (".ts", ".m3u8") or p.name == "thumb.jpg")
    st, d, _ = req("POST", f"{API}/videos/{vid}/upload-urls", {"files": files}, auth)
    ok(st == 200 and len(d["urls"]) == len(files), f"presigned {len(files)} upload URLs")
    for path, url in d["urls"].items():
        s, _, _ = req("PUT", url, (work / path).read_bytes(), raw=True)
        if s != 200:
            ok(False, f"PUT {path} -> {s}")
    ok(True, "uploaded every file straight to storage")

    tampered = d["urls"][files[0]].replace("X-Amz-Signature=", "X-Amz-Signature=0")
    ok(req("PUT", tampered, b"x", raw=True)[0] == 403, "storage rejects a tampered signature")

    st, d, _ = req("POST", f"{API}/videos/{vid}/complete", {
        "duration": 14, "width": 1280, "height": 720, "size_bytes": sum((work / f).stat().st_size for f in files),
        "has_thumbnail": True, "renditions": renditions,
    }, auth)
    ok(st == 200 and d["video"]["status"] == "ready", "complete → ready")

    # --- playback ---
    st, d, _ = req("GET", f"{API}/videos/{vid}/embed", headers=auth)
    preview = d["preview_url"]
    allowed = {"Referer": "http://localhost:5500/course"}
    st, _, _ = req("GET", preview.split("?")[0], headers=allowed, raw=True)
    ok(st == 403, "private video without token is refused")
    st, _, _ = req("GET", preview, headers={"Referer": "https://evil.example/"}, raw=True)
    ok(st == 403, "foreign site is refused")
    st, _, _ = req("GET", preview, raw=True)
    ok(st == 403, "direct (no referer) is refused")
    st, page, hdrs = req("GET", preview, headers=allowed, raw=True)
    ok(st == 200 and "frame-ancestors" in hdrs.get("Content-Security-Policy", ""), "allowed domain + token → player")
    sess = re.search(rb'"hls": "/v/([^/]+)/master\.m3u8"', page).group(1).decode()

    inner = {"Referer": f"{PLAYER}/embed/{vid}"}
    st, master, _ = req("GET", f"{PLAYER}/v/{sess}/master.m3u8", headers=inner, raw=True)
    ok(st == 200 and b"720.m3u8" in master and b"360.m3u8" in master, "master playlist lists both qualities")
    st, variant, _ = req("GET", f"{PLAYER}/v/{sess}/720.m3u8", headers=inner, raw=True)
    seg_urls = [l for l in variant.decode().split("\n") if l.startswith("http")]
    ok(st == 200 and b'URI="key"' in variant and len(seg_urls) >= 2, f"variant playlist: {len(seg_urls)} presigned segments")
    st, key, _ = req("GET", f"{PLAYER}/v/{sess}/key", headers=inner, raw=True)
    ok(st == 200 and key.hex() == up["key_hex"], "key served to the player session")
    ok(req("GET", f"{PLAYER}/v/{sess}/key", headers={"Origin": "https://evil.example"}, raw=True)[0] == 403, "key refused to a foreign origin")

    st, seg, _ = req("GET", seg_urls[0], raw=True)
    ok(st == 200 and not seg.startswith(b"\x47"), "raw segment from storage is ciphertext (no TS sync byte)")
    m = re.search(r"IV=0x([0-9a-fA-F]{32})", variant.decode())
    plain = subprocess.run(["openssl", "enc", "-d", "-aes-128-cbc", "-K", key.hex(), "-iv", m.group(1)],
                           input=seg, capture_output=True, check=True).stdout
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", "-"],
                           input=plain, capture_output=True).stdout.decode().split()
    ok(plain[:1] == b"\x47" and "h264" in probe, f"decrypted with the gate's key → MPEG-TS ({', '.join(probe)})")

    st, _, _ = req("DELETE", f"{API}/videos/{vid}", headers=auth)
    ok(st == 200, "delete video")
    ok(req("GET", seg_urls[0], raw=True)[0] == 404, "segments removed from storage")
    print("all good")


if __name__ == "__main__":
    main()
