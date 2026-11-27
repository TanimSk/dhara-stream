"""Tiny R2 (S3 API) client bound to one client bucket. Credentials never leave the server."""

import base64
import datetime as dt
import hashlib
import logging
import xml.etree.ElementTree as ET
from urllib.parse import urlparse

import requests
from django.conf import settings

from . import sigv4

log = logging.getLogger("dhara")
S3NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


class R2Error(Exception):
    pass


def _now():
    return dt.datetime.now(dt.timezone.utc)


class R2:
    def __init__(self, account_id: str, bucket: str, access_key: str, secret_key: str, endpoint: str = ""):
        endpoint = endpoint or settings.R2_ENDPOINT_OVERRIDE or f"https://{account_id}.r2.cloudflarestorage.com"
        u = urlparse(endpoint)
        self.scheme, self.host = u.scheme, u.netloc
        self.bucket = bucket
        self.access_key = access_key
        self.secret_key = secret_key

    @classmethod
    def for_bucket(cls, b):
        return cls(b.account_id, b.name, b.access_key_id, b.secret_access_key)

    def _path(self, key: str = "") -> str:
        return f"/{self.bucket}/{key}" if key else f"/{self.bucket}"

    # ---------- presigned URLs (pure computation, no network) ----------

    def presign(self, method: str, key: str, ttl: int, now: dt.datetime | None = None) -> str:
        return sigv4.presign(
            method, self.host, self._path(key), self.access_key, self.secret_key,
            expires=ttl, now=now or _now(), scheme=self.scheme,
        )

    def presign_get_shared(self, key: str, ttl: int, window: int = 3600) -> str:
        """
        GET URL signed at the start of the current `window`, so every viewer in that window gets the
        same URL (cacheable rewrites). It stays valid for at least ttl - window seconds.
        """
        now = _now()
        start = dt.datetime.fromtimestamp(int(now.timestamp()) // window * window, tz=dt.timezone.utc)
        return self.presign("GET", key, ttl, now=start)

    # ---------- header-signed requests ----------

    def _request(self, method, key="", *, query=None, body=b"", headers=None, timeout=15):
        path = self._path(key)
        signed = sigv4.sign_headers(
            method, self.host, path, self.access_key, self.secret_key,
            now=_now(), query=query, body=body, headers=headers,
        )
        url = f"{self.scheme}://{self.host}{sigv4.uri_encode(path, safe='/')}"
        if query:
            url += "?" + sigv4.canonical_query(query)
        try:
            return requests.request(method, url, data=body or None, headers=signed, timeout=timeout)
        except requests.RequestException as exc:
            raise R2Error(f"R2 request failed: {exc}") from exc

    def head(self, key: str) -> int | None:
        """Size in bytes, or None when the object doesn't exist."""
        r = self._request("HEAD", key)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise R2Error(f"HEAD {key} returned {r.status_code}")
        return int(r.headers.get("Content-Length", "0"))

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream"):
        r = self._request("PUT", key, body=data, headers={"content-type": content_type})
        if r.status_code not in (200, 201):
            raise R2Error(f"PUT {key} returned {r.status_code}")

    def list_keys(self, prefix: str):
        token = None
        while True:
            q = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
            if token:
                q["continuation-token"] = token
            r = self._request("GET", query=q)
            if r.status_code != 200:
                raise R2Error(f"LIST {prefix} returned {r.status_code}")
            root = ET.fromstring(r.content)
            for c in root.iter(f"{S3NS}Contents"):
                yield c.find(f"{S3NS}Key").text
            if (root.findtext(f"{S3NS}IsTruncated") or "false") != "true":
                return
            token = root.findtext(f"{S3NS}NextContinuationToken")

    def delete_prefix(self, prefix: str) -> int:
        """Delete every object under `prefix` (batches of 1000). Returns the count."""
        if not prefix or not prefix.endswith("/"):
            raise ValueError("delete_prefix needs a non-empty prefix ending in '/'")
        deleted, batch = 0, []
        for key in list(self.list_keys(prefix)):
            batch.append(key)
            if len(batch) == 1000:
                deleted += self._delete_batch(batch)
                batch = []
        if batch:
            deleted += self._delete_batch(batch)
        return deleted

    def _delete_batch(self, keys) -> int:
        root = ET.Element("Delete")
        ET.SubElement(root, "Quiet").text = "true"
        for k in keys:
            ET.SubElement(ET.SubElement(root, "Object"), "Key").text = k
        body = ET.tostring(root, xml_declaration=True, encoding="UTF-8")
        md5 = base64.b64encode(hashlib.md5(body).digest()).decode()
        r = self._request("POST", query={"delete": ""}, body=body,
                          headers={"content-md5": md5, "content-type": "application/xml"})
        if r.status_code != 200:
            raise R2Error(f"DELETE batch returned {r.status_code}")
        return len(keys)
