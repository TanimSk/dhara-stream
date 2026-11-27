"""Domain allow-list checks. Patterns are exact hosts ("school.com") or wildcards ("*.school.com")."""

import re
from urllib.parse import urlparse

from django.conf import settings

HOST_RE = re.compile(r"^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d{1,5})?$")


def normalize_pattern(value: str) -> str:
    """Accept 'https://School.com/path' or 'school.com' and return 'school.com'. Raises ValueError."""
    v = value.strip().lower()
    if "://" in v:
        v = urlparse(v).netloc
    v = v.split("/")[0]
    if not v or not HOST_RE.match(v):
        raise ValueError(f"'{value}' is not a valid domain")
    return v


def host_matches(host: str, pattern: str) -> bool:
    host, pattern = host.lower(), pattern.lower()
    if pattern.startswith("*."):
        base = pattern[2:]
        return host == base or host.endswith("." + base)
    return host == pattern


def host_of(url: str | None) -> str | None:
    if not url or url == "null":
        return None
    try:
        return urlparse(url).netloc.lower() or None
    except ValueError:
        return None


def requester_host(request) -> str | None:
    """Who is asking? Origin first, then Referer. None for apps, curl and typed-in URLs."""
    return host_of(request.headers.get("Origin")) or host_of(request.headers.get("Referer"))


def trusted_hosts() -> set[str]:
    # The desktop app previews from its own origin (the main process stamps that Referer).
    return {settings.PLAYER_HOST, settings.DASHBOARD_HOST, settings.DESKTOP_HOST}


def embed_allowed(host: str | None, client) -> bool:
    if host is None:
        return bool(client.allow_direct)
    if host in trusted_hosts():
        return True
    return any(host_matches(host, p) for p in client.allowed_domains or [])


def frame_ancestors(client) -> str:
    sources = ["'self'", settings.DASHBOARD_ORIGIN, settings.DESKTOP_ORIGIN]
    for d in client.allowed_domains or []:
        sources += [f"https://{d}", f"http://{d}"]
    return " ".join(sources)
