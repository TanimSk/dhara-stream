#!/usr/bin/env python3
"""
A tiny S3-compatible stand-in for Cloudflare R2, for local development only.

Verifies SigV4 (presigned query and Authorization header) with the same signer the backend uses,
enforces expiry, sends CORS headers, supports Range, ListObjectsV2 and DeleteObjects.
Objects live under var/r2/<bucket>/<key>.

    python dev/fake_r2.py            # :9000, credentials devkey / devsecret
"""

import datetime as dt
import hashlib
import hmac
import os
import re
import sys
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from utils import sigv4  # noqa: E402

DATA = ROOT / "var" / "r2"
KEYS = dict(kv.split(":", 1) for kv in os.getenv("FAKE_R2_KEYS", "devkey:devsecret").split(","))
PORT = int(os.getenv("FAKE_R2_PORT", "9000"))
NS = "http://s3.amazonaws.com/doc/2006-03-01/"


def parse_amz_date(s):
    return dt.datetime.strptime(s, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)


class Handler(BaseHTTPRequestHandler):
    server_version = "fake-r2"

    def log_message(self, fmt, *args):
        if os.getenv("FAKE_R2_QUIET") != "1":
            super().log_message(fmt, *args)

    # ---------- helpers ----------

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, PUT")
            self.send_header("Access-Control-Allow-Headers", "content-type, range")
            self.send_header("Access-Control-Expose-Headers", "ETag, Content-Length, Content-Range")
            self.send_header("Vary", "Origin")

    def _send(self, code, body=b"", ctype="application/xml", extra=None):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, code, s3code, msg):
        body = f"<?xml version='1.0'?><Error><Code>{s3code}</Code><Message>{msg}</Message></Error>".encode()
        self._send(code, body)

    def _split(self):
        u = urlsplit(self.path)
        parts = unquote(u.path).lstrip("/").split("/", 1)
        bucket = parts[0]
        key = parts[1] if len(parts) > 1 else ""
        return u, bucket, key, dict(parse_qsl(u.query, keep_blank_values=True))

    def _authorized(self, u, query, body: bytes) -> bool:
        host = self.headers.get("Host", "")
        path = unquote(u.path)
        if "X-Amz-Signature" in query:
            access = query["X-Amz-Credential"].split("/")[0]
            secret = KEYS.get(access)
            if not secret:
                return False
            signed_at = parse_amz_date(query["X-Amz-Date"])
            expires = int(query["X-Amz-Expires"])
            if dt.datetime.now(dt.timezone.utc) > signed_at + dt.timedelta(seconds=expires):
                return False
            region = query["X-Amz-Credential"].split("/")[2]
            expected = sigv4.presign(self.command, host, path, access, secret, expires=expires, now=signed_at,
                                     region=region, scheme="http")
            return hmac.compare_digest(expected.rsplit("X-Amz-Signature=", 1)[1], query["X-Amz-Signature"])
        auth = self.headers.get("Authorization", "")
        m = re.match(r"AWS4-HMAC-SHA256 Credential=([^/]+)/\d{8}/([^/]+)/s3/aws4_request, SignedHeaders=([^,]+), Signature=(\w+)", auth)
        if not m:
            return False
        access, region, signed, sig = m.groups()
        secret = KEYS.get(access)
        if not secret or hashlib.sha256(body).hexdigest() != self.headers.get("x-amz-content-sha256"):
            return False
        extra = {h: self.headers.get(h, "") for h in signed.split(";") if h not in ("host", "x-amz-date", "x-amz-content-sha256")}
        q = {k: v for k, v in query.items()}
        expected = sigv4.sign_headers(self.command, host, path, access, secret,
                                      now=parse_amz_date(self.headers.get("x-amz-date", "")),
                                      query=q, body=body, headers=extra, region=region)
        return hmac.compare_digest(expected["authorization"].rsplit("Signature=", 1)[1], sig)

    def _file(self, bucket, key) -> Path:
        p = (DATA / bucket / key).resolve()
        if not str(p).startswith(str((DATA / bucket).resolve())):
            raise PermissionError
        return p

    # ---------- verbs ----------

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain", {"Access-Control-Max-Age": "600"})

    def _read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_PUT(self):
        u, bucket, key, q = self._split()
        body = self._read_body()
        if not key or not self._authorized(u, q, body):
            return self._error(403, "SignatureDoesNotMatch", "bad signature")
        f = self._file(bucket, key)
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(body)
        self._send(200, b"", "text/plain", {"ETag": f'"{hashlib.md5(body).hexdigest()}"'})

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u, bucket, key, q = self._split()
        if not self._authorized(u, q, b""):
            return self._error(403, "SignatureDoesNotMatch", "bad signature")
        if not key:
            return self._list(bucket, q)
        f = self._file(bucket, key)
        if not f.is_file():
            return self._error(404, "NoSuchKey", "not found")
        data = f.read_bytes()
        ctype = {".ts": "video/mp2t", ".m3u8": "application/vnd.apple.mpegurl", ".jpg": "image/jpeg", ".mp4": "video/mp4"}.get(f.suffix, "application/octet-stream")
        rng = self.headers.get("Range")
        if rng and (m := re.match(r"bytes=(\d*)-(\d*)", rng)):
            start = int(m.group(1) or 0)
            end = int(m.group(2)) if m.group(2) else len(data) - 1
            end = min(end, len(data) - 1)
            return self._send(206, data[start:end + 1], ctype, {"Content-Range": f"bytes {start}-{end}/{len(data)}", "Accept-Ranges": "bytes"})
        self._send(200, data, ctype, {"Accept-Ranges": "bytes"})

    def _list(self, bucket, q):
        prefix = q.get("prefix", "")
        base = DATA / bucket
        keys = sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file()) if base.exists() else []
        keys = [k for k in keys if k.startswith(prefix)][:1000]
        root = ET.Element("ListBucketResult", xmlns=NS)
        ET.SubElement(root, "IsTruncated").text = "false"
        for k in keys:
            ET.SubElement(ET.SubElement(root, "Contents"), "Key").text = k
        self._send(200, ET.tostring(root, xml_declaration=True, encoding="UTF-8"))

    def do_POST(self):
        u, bucket, key, q = self._split()
        body = self._read_body()
        if "delete" not in q or not self._authorized(u, q, body):
            return self._error(403, "AccessDenied", "denied")
        for k in ET.fromstring(body).iter("Key"):
            f = self._file(bucket, k.text)
            if f.is_file():
                f.unlink()
        self._send(200, b"<DeleteResult/>")


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    print(f"fake R2 on http://127.0.0.1:{PORT}  (data: {DATA})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
