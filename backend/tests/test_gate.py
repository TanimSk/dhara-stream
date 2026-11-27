import re
import time

import pytest
from django.test import Client as HttpClient

from library.models import Category, Video
from utils.tokens import sign_playback

pytestmark = pytest.mark.django_db


def embed(video, referer="https://acme.com/course", **params):
    headers = {"HTTP_REFERER": referer} if referer else {}
    return HttpClient().get(f"/embed/{video.id}", params, **headers)


def session_from(resp):
    return re.search(r'"hls": "/v/([^/]+)/master\.m3u8"', resp.content.decode()).group(1)


def test_embed_on_allowed_domain(ready_video):
    r = embed(ready_video)
    assert r.status_code == 200
    assert "frame-ancestors 'self' https://dash.test app://dhara https://acme.com" in r["Content-Security-Policy"]
    assert "X-Frame-Options" not in r
    assert r["Referrer-Policy"] == "same-origin"
    assert "/static/hls.min.js" in r.content.decode()
    assert "dhara-key" not in r.content.decode()


@pytest.mark.parametrize("referer", ["https://evil.com/", "https://acme.com.evil.com/", None])
def test_embed_blocked_elsewhere(ready_video, referer):
    assert embed(ready_video, referer).status_code == 403


def test_embed_wildcard_and_dashboard(ready_video):
    assert embed(ready_video, "https://physics.school.org/").status_code == 200
    assert embed(ready_video, "https://dash.test/app/videos").status_code == 200


def test_direct_access_when_allowed(ready_video):
    ready_video.client.allow_direct = True
    ready_video.client.save()
    assert embed(ready_video, None).status_code == 200


def test_private_needs_valid_token(ready_video):
    ready_video.visibility = "private"
    ready_video.save()
    assert embed(ready_video).status_code == 403
    secret = ready_video.client.api_secret
    exp = int(time.time()) + 600
    assert embed(ready_video, token=sign_playback(secret, ready_video.id, exp), exp=exp).status_code == 200
    assert embed(ready_video, token=sign_playback("guess", ready_video.id, exp), exp=exp).status_code == 403
    past = int(time.time()) - 5
    assert embed(ready_video, token=sign_playback(secret, ready_video.id, past), exp=past).status_code == 403


def test_private_category_makes_video_private(ready_video):
    ready_video.category = Category.objects.create(client=ready_video.client, name="Paid", visibility="private")
    ready_video.save()
    assert embed(ready_video).status_code == 403


def test_playlists_and_key(ready_video):
    sess = session_from(embed(ready_video))
    http = HttpClient()
    ref = {"HTTP_REFERER": f"https://play.test/embed/{ready_video.id}"}

    master = http.get(f"/v/{sess}/master.m3u8", **ref)
    assert master.status_code == 200 and master["Content-Type"] == "application/vnd.apple.mpegurl"
    assert "RESOLUTION=1280x720" in master.content.decode() and "\n720.m3u8\n" in master.content.decode()

    variant = http.get(f"/v/{sess}/720.m3u8", **ref).content.decode()
    assert 'URI="key"' in variant
    segs = [l for l in variant.split("\n") if l and not l.startswith("#")]
    assert len(segs) == 2
    assert all(s.startswith(f"https://{'a' * 32}.r2.cloudflarestorage.com/dhara-acme/{ready_video.id}/720p/seg_0000") for s in segs)
    assert all("X-Amz-Signature=" in s for s in segs)

    key = http.get(f"/v/{sess}/key", **ref)
    assert key.status_code == 200 and key.content == bytes.fromhex(ready_video.aes_key)
    assert key["Cache-Control"] == "private, no-store"

    assert http.get(f"/v/{sess}/1080.m3u8", **ref).status_code == 404


def test_gate_rejects_foreign_or_forged_sessions(ready_video):
    sess = session_from(embed(ready_video))
    http = HttpClient()
    assert http.get(f"/v/{sess}/key", HTTP_ORIGIN="https://evil.com").status_code == 403
    assert http.get(f"/v/{sess}/master.m3u8", HTTP_REFERER="https://acme.com/").status_code == 403
    assert http.get(f"/v/{sess[:-3]}abc/key").status_code == 403
    # copied URL without headers still needs a live session (works only until it expires)
    assert http.get(f"/v/{sess}/key").status_code == 200


def test_suspended_client_stops_playback_immediately(ready_video):
    sess = session_from(embed(ready_video))
    ready_video.client.status = "suspended"
    ready_video.client.save()
    assert embed(ready_video).status_code == 403
    assert HttpClient().get(f"/v/{sess}/key").status_code == 403


def test_not_ready_video_is_not_found(ready_video):
    ready_video.status = Video.Status.UPLOADING
    ready_video.save()
    assert embed(ready_video).status_code == 404


def test_portrait_master_uses_pixel_size(ready_video):
    ready_video.renditions = [{"height": 720, "width": 720, "pixel_height": 1280, "bandwidth": 2000000, "codecs": "", "segments": 2}]
    ready_video.save()
    sess = session_from(embed(ready_video))
    body = HttpClient().get(f"/v/{sess}/master.m3u8").content.decode()
    assert "RESOLUTION=720x1280" in body and "CODECS" not in body


def test_mp4_redirects_to_presigned_url(ready_video):
    ready_video.source = Video.Source.MP4
    ready_video.save()
    r = embed(ready_video)
    sess = re.search(r'"hls": "/v/([^/]+)/video\.mp4"', r.content.decode()).group(1)
    red = HttpClient().get(f"/v/{sess}/video.mp4")
    assert red.status_code == 302 and f"/{ready_video.id}/video.mp4?" in red["Location"]
