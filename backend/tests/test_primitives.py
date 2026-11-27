import datetime as dt
import time

import pytest

from library import hls
from utils import sigv4
from utils.domains import embed_allowed, host_matches, normalize_pattern
from utils.tokens import make_session, read_session, sign_playback, verify_playback

from .conftest import GOOD_PLAYLIST

AWS_KEY, AWS_SECRET = "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
AWS_NOW = dt.datetime(2013, 5, 24, tzinfo=dt.timezone.utc)


def test_presign_matches_aws_reference_vector():
    url = sigv4.presign("GET", "examplebucket.s3.amazonaws.com", "/test.txt", AWS_KEY, AWS_SECRET,
                        expires=86400, now=AWS_NOW, region="us-east-1")
    assert url.endswith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404")


def test_header_signing_matches_aws_reference_vector():
    h = sigv4.sign_headers("GET", "examplebucket.s3.amazonaws.com", "/test.txt", AWS_KEY, AWS_SECRET,
                           now=AWS_NOW, headers={"Range": "bytes=0-9"}, region="us-east-1")
    assert h["authorization"].endswith("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41")


def test_playback_token(settings):
    exp = int(time.time()) + 600
    t = sign_playback("s3cret", "vid", exp)
    assert verify_playback("s3cret", "vid", t, exp)
    assert not verify_playback("s3cret", "other-vid", t, exp)
    assert not verify_playback("wrong", "vid", t, exp)
    assert not verify_playback("s3cret", "vid", t, exp + 1)
    assert not verify_playback("s3cret", "vid", None, exp)
    past = int(time.time()) - 1
    assert not verify_playback("s3cret", "vid", sign_playback("s3cret", "vid", past), past)
    far = int(time.time()) + settings.MAX_PLAYBACK_TOKEN_TTL + 100
    assert not verify_playback("s3cret", "vid", sign_playback("s3cret", "vid", far), far)


def test_session_roundtrip_and_tamper():
    s = make_session("abc", "acme.com")
    assert read_session(s)["v"] == "abc"
    assert read_session(s[:-2] + "xx") is None


def test_domains():
    assert host_matches("a.school.org", "*.school.org")
    assert host_matches("school.org", "*.school.org")
    assert not host_matches("evilschool.org", "*.school.org")
    assert normalize_pattern("https://Acme.com/path") == "acme.com"
    with pytest.raises(ValueError):
        normalize_pattern("not a domain")

    class C:
        allowed_domains = ["acme.com"]
        allow_direct = False

    assert embed_allowed("acme.com", C)
    assert embed_allowed("dash.test", C)  # dashboard preview is trusted
    assert not embed_allowed("evil.com", C)
    assert not embed_allowed(None, C)
    C.allow_direct = True
    assert embed_allowed(None, C)


def test_validate_variant_accepts_ffmpeg_output():
    text, segs = hls.validate_variant(GOOD_PLAYLIST)
    assert segs == ["seg_00000.ts", "seg_00001.ts"]


@pytest.mark.parametrize("bad", [
    GOOD_PLAYLIST.replace("seg_00001.ts", "https://evil.com/x.ts"),
    GOOD_PLAYLIST.replace('URI="dhara-key"', 'URI="https://evil.com/key"'),
    "\n".join(l for l in GOOD_PLAYLIST.split("\n") if not l.startswith("#EXT-X-KEY")),
    GOOD_PLAYLIST.replace("#EXT-X-ENDLIST", ""),
    GOOD_PLAYLIST.replace("#EXTM3U", "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\""),
])
def test_validate_variant_rejects(bad):
    with pytest.raises(ValueError):
        hls.validate_variant(bad)
