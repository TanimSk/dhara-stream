"""
Cloudflare API: create a client's R2 bucket, its CORS rules and a bucket-scoped S3 credential.

The platform token (CF_API_TOKEN) needs "Workers R2 Storage: Edit" and "Account API Tokens: Edit".
"""

import hashlib
import logging
from functools import lru_cache

import requests
from django.conf import settings

log = logging.getLogger("dhara")
API = "https://api.cloudflare.com/client/v4"
WRITE_GROUP = "Workers R2 Storage Bucket Item Write"


class CloudflareError(Exception):
    pass


def configured() -> bool:
    return bool(settings.CF_ACCOUNT_ID and settings.CF_API_TOKEN)


def _call(method, path, *, json=None, ok_codes=()):
    try:
        r = requests.request(
            method, f"{API}{path}", json=json, timeout=20,
            headers={"Authorization": f"Bearer {settings.CF_API_TOKEN}"},
        )
        data = r.json()
    except (requests.RequestException, ValueError) as exc:
        raise CloudflareError(f"Cloudflare API unreachable: {exc}") from exc
    if not data.get("success"):
        errors = data.get("errors") or []
        if any(e.get("code") in ok_codes for e in errors):
            return None
        msg = "; ".join(f"{e.get('code')}: {e.get('message')}" for e in errors) or f"HTTP {r.status_code}"
        raise CloudflareError(msg)
    return data.get("result")


def _acct():
    return f"/accounts/{settings.CF_ACCOUNT_ID}"


def create_bucket(name: str):
    # 10004: bucket already exists (and is ours) — provisioning is idempotent.
    _call("POST", f"{_acct()}/r2/buckets", json={"name": name}, ok_codes=(10004,))


def set_cors(name: str):
    rules = [
        {   # the embed player fetches segments and posters straight from R2
            "allowed": {"origins": [settings.PLAYER_ORIGIN, settings.DASHBOARD_ORIGIN], "methods": ["GET", "HEAD"]},
            "maxAgeSeconds": 86400,
        },
        {   # browser uploads from the dashboard (the desktop app uploads from Node, no CORS)
            "allowed": {"origins": [settings.DASHBOARD_ORIGIN], "methods": ["PUT"], "headers": ["content-type"]},
            "exposeHeaders": ["ETag"],
            "maxAgeSeconds": 86400,
        },
    ]
    _call("PUT", f"{_acct()}/r2/buckets/{name}/cors", json={"rules": rules})


@lru_cache(maxsize=1)
def _write_group_id() -> str:
    groups = _call("GET", f"{_acct()}/tokens/permission_groups") or []
    for g in groups:
        if g.get("name") == WRITE_GROUP:
            return g["id"]
    raise CloudflareError(f"Permission group '{WRITE_GROUP}' not found on this account")


def create_scoped_credentials(bucket: str) -> tuple[str, str, str]:
    """Returns (token_id, access_key_id, secret_access_key) limited to one bucket."""
    resource = f"com.cloudflare.edge.r2.bucket.{settings.CF_ACCOUNT_ID}_default_{bucket}"
    result = _call("POST", f"{_acct()}/tokens", json={
        "name": f"dhara {bucket}",
        "policies": [{"effect": "allow", "permission_groups": [{"id": _write_group_id()}], "resources": {resource: "*"}}],
    })
    token_id, value = result["id"], result["value"]
    # R2's S3 credentials derive from an API token: key id = token id, secret = sha256(token value).
    return token_id, token_id, hashlib.sha256(value.encode()).hexdigest()


def delete_token(token_id: str):
    if token_id:
        _call("DELETE", f"{_acct()}/tokens/{token_id}", ok_codes=(1003, 7003))


def delete_bucket(name: str):
    _call("DELETE", f"{_acct()}/r2/buckets/{name}", ok_codes=(10006,))
