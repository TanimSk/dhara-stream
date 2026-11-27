import time

import pytest
from rest_framework.test import APIClient

from administrator.models import User
from clients.models import Client, R2Bucket
from library.models import Category, Video
from utils.tokens import sign_playback

from .conftest import GOOD_PLAYLIST, auth, make_client

pytestmark = pytest.mark.django_db


# ---------------- auth ----------------

def test_login_web_sets_cookie_and_refresh_rotates(acme):
    api = APIClient()
    r = api.post("/api/v1/auth/login", {"email": "acme@example.com", "password": "pass-word-123"}, format="json")
    assert r.status_code == 200 and "refresh" not in r.data and r.data["user"]["role"] == "client"
    assert r.cookies["dhara_refresh"]["httponly"]
    r2 = api.post("/api/v1/auth/refresh")
    assert r2.status_code == 200 and r2.data["access"]


def test_login_desktop_returns_refresh_in_body(acme):
    api = APIClient()
    r = api.post("/api/v1/auth/login", {"email": "ACME@example.com", "password": "pass-word-123", "device": "desktop"}, format="json")
    assert r.status_code == 200 and r.data["refresh"]
    r2 = api.post("/api/v1/auth/refresh", {"refresh": r.data["refresh"]}, format="json")
    assert r2.status_code == 200 and r2.data["refresh"] != r.data["refresh"]
    # the old refresh token is blacklisted after rotation
    assert api.post("/api/v1/auth/refresh", {"refresh": r.data["refresh"]}, format="json").status_code == 401


def test_login_wrong_password(acme):
    r = APIClient().post("/api/v1/auth/login", {"email": "acme@example.com", "password": "nope"}, format="json")
    assert r.status_code == 401 and r.data["success"] is False


# ---------------- master admin ----------------

def test_client_user_cannot_use_admin_api(acme):
    _, user = acme
    assert auth(user).get("/api/v1/admin/clients").status_code == 403


def test_master_creates_client_without_cloudflare(master):
    r = auth(master).post("/api/v1/admin/clients", {
        "name": "Bright School", "email": "Owner@Bright.com", "allowed_domains": ["https://bright.com/x", "*.bright.com"],
    }, format="json")
    assert r.status_code == 201, r.data
    c = r.data["client"]
    assert c["allowed_domains"] == ["bright.com", "*.bright.com"]
    assert c["bucket"]["status"] == "failed" and "Cloudflare" in c["bucket"]["error"]
    assert r.data["password"]
    u = User.objects.get(email="owner@bright.com")
    assert u.role == "client" and u.client_id == c["id"] and u.check_password(r.data["password"])


def test_master_manual_bucket_and_suspend(master, acme):
    client, user = acme
    api = auth(master)
    r = api.put(f"/api/v1/admin/clients/{client.id}/bucket", {
        "name": "acme-videos", "account_id": "b" * 32, "access_key_id": "K", "secret_access_key": "S",
    }, format="json")
    assert r.status_code == 200 and r.data["bucket"]["status"] == "ready"
    assert "secret_access_key" not in r.data["bucket"]
    assert R2Bucket.objects.get(client=client).secret_access_key == "S"
    api.patch(f"/api/v1/admin/clients/{client.id}", {"status": "suspended"}, format="json")
    user.refresh_from_db()  # real requests load the user fresh
    assert auth(user).get("/api/v1/videos").status_code == 403


def test_master_reset_password(master, acme):
    client, user = acme
    r = auth(master).post(f"/api/v1/admin/clients/{client.id}/reset-password")
    user.refresh_from_db()
    assert user.check_password(r.data["password"])


# ---------------- client isolation ----------------

def test_clients_cannot_touch_each_other(acme, other, ready_video, no_r2_network):
    _, other_user = other
    api = auth(other_user)
    cat = Category.objects.create(client=acme[0], name="Physics")
    assert api.get(f"/api/v1/videos/{ready_video.id}").status_code == 404
    assert api.patch(f"/api/v1/videos/{ready_video.id}", {"title": "x"}, format="json").status_code == 404
    assert api.delete(f"/api/v1/videos/{ready_video.id}").status_code == 404
    assert api.get(f"/api/v1/videos/{ready_video.id}/embed").status_code == 404
    assert api.post(f"/api/v1/videos/{ready_video.id}/upload-urls", {"files": ["thumb.jpg"]}, format="json").status_code == 404
    assert api.patch(f"/api/v1/categories/{cat.id}", {"name": "x"}, format="json").status_code == 404
    assert api.get("/api/v1/videos").data["count"] == 0
    # can't file a video under someone else's category
    r = api.post("/api/v1/videos", {"title": "t", "category": cat.id}, format="json")
    assert r.status_code == 400


def test_master_is_not_a_client(master):
    assert auth(master).get("/api/v1/videos").status_code == 403


# ---------------- library + upload flow ----------------

def test_category_crud_and_private_inheritance(acme, ready_video):
    _, user = acme
    api = auth(user)
    r = api.post("/api/v1/categories", {"name": "Members", "visibility": "private"}, format="json")
    assert r.status_code == 201
    assert api.post("/api/v1/categories", {"name": "members"}, format="json").status_code == 400
    api.patch(f"/api/v1/videos/{ready_video.id}", {"category": r.data["category"]["id"]}, format="json")
    v = api.get(f"/api/v1/videos/{ready_video.id}").data["video"]
    assert v["visibility"] == "public" and v["effective_visibility"] == "private"
    assert v["thumbnail_url"].startswith("https://")


def test_hls_upload_flow(acme, no_r2_network):
    _, user = acme
    api = auth(user)
    r = api.post("/api/v1/videos", {"title": "Algebra", "visibility": "private"}, format="json")
    assert r.status_code == 201
    vid, up = r.data["video"]["id"], r.data["upload"]
    assert len(up["key_hex"]) == 32 and up["key_uri"] == "dhara-key"

    files = ["thumb.jpg", "720p/index.m3u8", "720p/seg_00000.ts", "480p/seg_00001.ts"]
    r = api.post(f"/api/v1/videos/{vid}/upload-urls", {"files": files}, format="json")
    assert r.status_code == 200 and set(r.data["urls"]) == set(files)
    assert f"/{vid}/720p/seg_00000.ts?" in r.data["urls"]["720p/seg_00000.ts"]
    for bad in ["../x.ts", "720p/../../x", "999p/seg_00000.ts", "video.mp4", "720p/evil.html"]:
        assert api.post(f"/api/v1/videos/{vid}/upload-urls", {"files": [bad]}, format="json").status_code == 400, bad

    bad = api.post(f"/api/v1/videos/{vid}/complete", {
        "duration": 10.25, "width": 1280, "height": 720,
        "renditions": [{"height": 720, "width": 1280, "bandwidth": 2800000, "playlist": GOOD_PLAYLIST.replace('URI="dhara-key"', 'URI="x"')}],
    }, format="json")
    assert bad.status_code == 400

    r = api.post(f"/api/v1/videos/{vid}/complete", {
        "duration": 10.25, "width": 1280, "height": 720, "size_bytes": 5000, "has_thumbnail": True,
        "renditions": [{"height": 720, "width": 1280, "bandwidth": 2800000, "codecs": "avc1.64001f,mp4a.40.2", "playlist": GOOD_PLAYLIST}],
    }, format="json")
    assert r.status_code == 200, r.data
    assert r.data["video"]["status"] == "ready" and r.data["video"]["qualities"] == [720]
    # no more uploads once ready
    assert api.post(f"/api/v1/videos/{vid}/upload-urls", {"files": ["thumb.jpg"]}, format="json").status_code == 409
    assert api.get(f"/api/v1/videos/{vid}/upload-key").status_code == 409


def test_complete_rejects_missing_segments(acme, monkeypatch):
    from utils.r2 import R2

    monkeypatch.setattr(R2, "head", lambda self, key: None)
    _, user = acme
    api = auth(user)
    vid = api.post("/api/v1/videos", {"title": "x"}, format="json").data["video"]["id"]
    r = api.post(f"/api/v1/videos/{vid}/complete", {
        "duration": 10, "width": 1280, "height": 720,
        "renditions": [{"height": 720, "width": 1280, "bandwidth": 2800000, "playlist": GOOD_PLAYLIST}],
    }, format="json")
    assert r.status_code == 409 and "720p/seg_00001.ts" in r.data["message"]


def test_mp4_upload_flow(acme, no_r2_network):
    _, user = acme
    api = auth(user)
    vid = api.post("/api/v1/videos", {"title": "Raw", "source": "mp4", "uploaded_via": "web"}, format="json").data["video"]["id"]
    assert api.post(f"/api/v1/videos/{vid}/upload-urls", {"files": ["video.mp4"]}, format="json").status_code == 200
    assert api.post(f"/api/v1/videos/{vid}/upload-urls", {"files": ["720p/seg_00000.ts"]}, format="json").status_code == 400
    r = api.post(f"/api/v1/videos/{vid}/complete", {"duration": 5, "width": 640, "height": 360}, format="json")
    assert r.status_code == 200 and r.data["video"]["size_bytes"] == 1234


def test_upload_needs_ready_bucket(acme):
    client, user = acme
    client.bucket.status = R2Bucket.Status.FAILED
    client.bucket.save()
    assert auth(user).post("/api/v1/videos", {"title": "x"}, format="json").status_code == 409


def test_account_settings_and_api_key(acme):
    client, user = acme
    api = auth(user)
    r = api.patch("/api/v1/account", {"allowed_domains": ["https://new.com"], "allow_direct": True, "name": "hack"}, format="json")
    assert r.status_code == 200 and r.data["account"]["allowed_domains"] == ["new.com"]
    client.refresh_from_db()
    assert client.name == "Acme" and client.allow_direct
    old = api.get("/api/v1/account/api-key").data["secret"]
    new = api.post("/api/v1/account/api-key/rotate").data["secret"]
    assert old != new and new.startswith("dsk_")


def test_playback_token_endpoint(acme, other, ready_video):
    client, _ = acme
    api = APIClient()
    hdr = {"HTTP_AUTHORIZATION": f"ApiKey {client.api_key_id}:{client.api_secret}"}
    r = api.post("/api/v1/playback-token", {"video_id": str(ready_video.id), "ttl": 600}, format="json", **hdr)
    assert r.status_code == 200 and r.data["token"] == sign_playback(client.api_secret, ready_video.id, r.data["exp"])
    assert api.post("/api/v1/playback-token", {"video_id": str(ready_video.id)}, format="json",
                    HTTP_AUTHORIZATION=f"ApiKey {client.api_key_id}:wrong").status_code == 401
    o = other[0]
    assert api.post("/api/v1/playback-token", {"video_id": str(ready_video.id)}, format="json",
                    HTTP_AUTHORIZATION=f"ApiKey {o.api_key_id}:{o.api_secret}").status_code == 404
