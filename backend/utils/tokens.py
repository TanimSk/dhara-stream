"""
Playback tokens and gate sessions.

Client token (minted by the client's backend with its API secret, never in the browser):
    token = base64url(HMAC_SHA256(secret, "{video_id}:{exp}")), no padding; exp = unix seconds.

Gate session (minted by /embed after all checks pass, carried in playlist/key paths):
    django.core.signing blob {"v": video_id, "h": viewer host}, max age PLAYBACK_SESSION_TTL.
"""

import base64
import hashlib
import hmac
import time

from django.conf import settings
from django.core import signing

SESSION_SALT = "dhara.playback.session"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def sign_playback(secret: str, video_id, exp: int) -> str:
    return b64url(hmac.new(secret.encode(), f"{video_id}:{int(exp)}".encode(), hashlib.sha256).digest())


def verify_playback(secret: str, video_id, token: str | None, exp, now: float | None = None) -> bool:
    if not token or not secret or not str(exp or "").isdigit() or len(str(exp)) > 12:
        return False
    now = time.time() if now is None else now
    exp = int(exp)
    if exp < now or exp - now > settings.MAX_PLAYBACK_TOKEN_TTL:
        return False
    return hmac.compare_digest(sign_playback(secret, video_id, exp), token)


def make_session(video_id, host: str | None) -> str:
    return signing.dumps({"v": str(video_id), "h": host or ""}, salt=SESSION_SALT, compress=False)


def read_session(value: str) -> dict | None:
    try:
        return signing.loads(value, salt=SESSION_SALT, max_age=settings.PLAYBACK_SESSION_TTL)
    except signing.BadSignature:
        return None
