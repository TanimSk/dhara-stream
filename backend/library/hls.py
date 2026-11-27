"""
Playlist validation (on upload complete) and rewriting (at the playback gate).

Uploaders write variant playlists with ffmpeg using the key URI "dhara-key" and segment names
seg_00001.ts. We only accept that exact shape, so a client can never point viewers at other URLs.
"""

import re
import time
from collections import OrderedDict

from django.conf import settings

KEY_URI = "dhara-key"
SEG_RE = re.compile(r"^seg_\d{5}\.ts$")
KEY_RE = re.compile(r'^#EXT-X-KEY:METHOD=AES-128,URI="dhara-key"(,IV=0x[0-9A-Fa-f]{32})?$')
EXTINF_RE = re.compile(r"^#EXTINF:\d+(\.\d+)?,.*$")
CODECS_RE = re.compile(r"^[A-Za-z0-9.,]{1,80}$")
SIMPLE_TAGS = re.compile(
    r"^#(EXTM3U|EXT-X-VERSION:\d+|EXT-X-TARGETDURATION:\d+|EXT-X-MEDIA-SEQUENCE:\d+|EXT-X-PLAYLIST-TYPE:VOD"
    r"|EXT-X-INDEPENDENT-SEGMENTS|EXT-X-ENDLIST|EXT-X-DISCONTINUITY|EXT-X-ALLOW-CACHE:(YES|NO))$"
)
MAX_PLAYLIST_BYTES = 2 * 1024 * 1024


def validate_variant(text: str) -> tuple[str, list[str]]:
    """Return (normalized playlist, segment names). Raises ValueError with a readable reason."""
    if not isinstance(text, str) or len(text) > MAX_PLAYLIST_BYTES:
        raise ValueError("playlist missing or too large")
    lines = [l.strip() for l in text.replace("\r\n", "\n").split("\n") if l.strip()]
    if not lines or lines[0] != "#EXTM3U":
        raise ValueError("playlist must start with #EXTM3U")
    out, segments, has_key, has_end, expect_seg = [], [], False, False, False
    for line in lines:
        if expect_seg:
            if not SEG_RE.match(line):
                raise ValueError(f"unexpected segment name '{line[:40]}'")
            segments.append(line)
            expect_seg = False
        elif EXTINF_RE.match(line):
            expect_seg = True
        elif KEY_RE.match(line):
            has_key = True
        elif SIMPLE_TAGS.match(line):
            has_end = has_end or line == "#EXT-X-ENDLIST"
        else:
            raise ValueError(f"unsupported playlist line '{line[:40]}'")
        out.append(line)
    if expect_seg:
        raise ValueError("playlist ends with #EXTINF but no segment")
    if not segments:
        raise ValueError("playlist has no segments")
    if not has_key:
        raise ValueError("segments must be AES-128 encrypted (missing #EXT-X-KEY)")
    if not has_end:
        raise ValueError("playlist must end with #EXT-X-ENDLIST (VOD)")
    return "\n".join(out) + "\n", segments


def build_master(renditions: list[dict]) -> str:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"]
    for r in sorted(renditions, key=lambda r: r["height"]):
        attrs = f'BANDWIDTH={int(r["bandwidth"])},RESOLUTION={int(r["width"])}x{int(r["height"])}'
        if r.get("codecs"):
            attrs += f',CODECS="{r["codecs"]}"'
        lines += [f"#EXT-X-STREAM-INF:{attrs}", f'{int(r["height"])}.m3u8']
    return "\n".join(lines) + "\n"


class _LRU:
    def __init__(self, size):
        self.size, self.data = size, OrderedDict()

    def get(self, key):
        if key in self.data:
            self.data.move_to_end(key)
            return self.data[key]
        return None

    def put(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        while len(self.data) > self.size:
            self.data.popitem(last=False)


# Rewritten playlists are identical for every viewer within a signing window, so popular videos
# cost one rewrite per worker per hour.
_cache = _LRU(256)
SIGN_WINDOW = 3600


def rewrite_variant(video, height: int, r2) -> str:
    """Segment names -> presigned R2 URLs; key URI -> 'key' (resolves to /v/<session>/key)."""
    key = (str(video.id), height, video.updated_at.timestamp(), r2.access_key, int(time.time()) // SIGN_WINDOW)
    body = _cache.get(key)
    if body is None:
        body = _rewrite(video, height, r2)
        _cache.put(key, body)
    return body


def _rewrite(video, height, r2) -> str:
    text = video.playlists.get(str(height), "")
    ttl = settings.SEGMENT_URL_TTL
    out = []
    for line in text.split("\n"):
        if SEG_RE.match(line):
            out.append(r2.presign_get_shared(f"{video.id}/{height}p/{line}", ttl, window=SIGN_WINDOW))
        elif line.startswith("#EXT-X-KEY:"):
            out.append(line.replace(f'URI="{KEY_URI}"', 'URI="key"'))
        else:
            out.append(line)
    return "\n".join(out)
