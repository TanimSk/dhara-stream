"""
Minimal AWS Signature V4 for R2's S3 API: query-string presigning and header-signed requests.

Hand-written (no boto3) so a playlist rewrite can presign hundreds of segment URLs in a few
milliseconds and each gunicorn worker stays small.
"""

import datetime as dt
import hashlib
import hmac
from functools import lru_cache
from urllib.parse import quote

ALGORITHM = "AWS4-HMAC-SHA256"
UNSIGNED = "UNSIGNED-PAYLOAD"


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


@lru_cache(maxsize=256)
def signing_key(secret: str, date: str, region: str, service: str = "s3") -> bytes:
    k = _hmac(("AWS4" + secret).encode(), date)
    k = _hmac(k, region)
    k = _hmac(k, service)
    return _hmac(k, "aws4_request")


def uri_encode(value: str, safe: str = "") -> str:
    return quote(value, safe="-_.~" + safe)


def canonical_query(params: dict) -> str:
    return "&".join(f"{uri_encode(k)}={uri_encode(str(v))}" for k, v in sorted(params.items()))


def amz_dates(now: dt.datetime):
    now = now.astimezone(dt.timezone.utc)
    return now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")


def presign(
    method: str,
    host: str,
    path: str,
    access_key: str,
    secret_key: str,
    *,
    expires: int,
    now: dt.datetime,
    region: str = "auto",
    scheme: str = "https",
) -> str:
    """Return a presigned URL. `path` is the raw (unencoded) absolute path, e.g. /bucket/key."""
    amz_date, date = amz_dates(now)
    scope = f"{date}/{region}/s3/aws4_request"
    params = {
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": f"{access_key}/{scope}",
        "X-Amz-Date": amz_date,
        "X-Amz-Expires": str(expires),
        "X-Amz-SignedHeaders": "host",
    }
    cpath = uri_encode(path, safe="/")
    query = canonical_query(params)
    creq = f"{method}\n{cpath}\n{query}\nhost:{host}\n\nhost\n{UNSIGNED}"
    sts = f"{ALGORITHM}\n{amz_date}\n{scope}\n{hashlib.sha256(creq.encode()).hexdigest()}"
    sig = hmac.new(signing_key(secret_key, date, region), sts.encode(), hashlib.sha256).hexdigest()
    return f"{scheme}://{host}{cpath}?{query}&X-Amz-Signature={sig}"


def sign_headers(
    method: str,
    host: str,
    path: str,
    access_key: str,
    secret_key: str,
    *,
    now: dt.datetime,
    query: dict | None = None,
    body: bytes = b"",
    headers: dict | None = None,
    region: str = "auto",
) -> dict:
    """Return the headers (incl. Authorization) for a header-signed request."""
    amz_date, date = amz_dates(now)
    scope = f"{date}/{region}/s3/aws4_request"
    payload_hash = hashlib.sha256(body).hexdigest()
    all_headers = {k.lower(): str(v).strip() for k, v in (headers or {}).items()}
    all_headers.update({"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date})
    names = sorted(all_headers)
    canonical_headers = "".join(f"{n}:{all_headers[n]}\n" for n in names)
    signed = ";".join(names)
    creq = "\n".join(
        [method, uri_encode(path, safe="/"), canonical_query(query or {}), canonical_headers, signed, payload_hash]
    )
    sts = f"{ALGORITHM}\n{amz_date}\n{scope}\n{hashlib.sha256(creq.encode()).hexdigest()}"
    sig = hmac.new(signing_key(secret_key, date, region), sts.encode(), hashlib.sha256).hexdigest()
    all_headers["authorization"] = f"{ALGORITHM} Credential={access_key}/{scope}, SignedHeaders={signed}, Signature={sig}"
    del all_headers["host"]
    return all_headers
