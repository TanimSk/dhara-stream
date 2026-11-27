import pytest
from rest_framework.test import APIClient

from administrator.models import User
from clients.models import Client, R2Bucket
from library.models import Video

GOOD_PLAYLIST = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-KEY:METHOD=AES-128,URI="dhara-key",IV=0x00000000000000000000000000000000
#EXTINF:6.000000,
seg_00000.ts
#EXTINF:4.250000,
seg_00001.ts
#EXT-X-ENDLIST
"""


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.PLAYER_ORIGIN = "https://play.test"
    settings.PLAYER_HOST = "play.test"
    settings.DASHBOARD_ORIGIN = "https://dash.test"
    settings.DASHBOARD_HOST = "dash.test"
    settings.CF_ACCOUNT_ID = ""
    settings.CF_API_TOKEN = ""
    settings.R2_ENDPOINT_OVERRIDE = ""


def make_client(name="Acme", domains=("acme.com",), email=None):
    c = Client.objects.create(name=name, slug=Client.unique_slug(name), allowed_domains=list(domains))
    R2Bucket.objects.create(
        client=c, name=f"dhara-{c.slug}", account_id="a" * 32, access_key_id="AKID",
        secret_access_key="SECRET", status=R2Bucket.Status.READY, manual=True,
    )
    u = User.objects.create_user(email or f"{c.slug}@example.com", "pass-word-123", role=User.Role.CLIENT, client=c)
    return c, u


def auth(user):
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def master(db):
    return User.objects.create_superuser("root@example.com", "pass-word-123")


@pytest.fixture
def acme(db):
    return make_client("Acme", ("acme.com", "*.school.org"))


@pytest.fixture
def other(db):
    return make_client("Other", ("other.com",))


@pytest.fixture
def ready_video(acme):
    client, _ = acme
    return Video.objects.create(
        client=client, title="Lesson 1", status=Video.Status.READY, duration=10.25, width=1280, height=720,
        renditions=[{"height": 720, "width": 1280, "bandwidth": 2800000, "codecs": "avc1.64001f,mp4a.40.2", "segments": 2}],
        playlists={"720": GOOD_PLAYLIST}, has_thumbnail=True,
    )


@pytest.fixture
def no_r2_network(monkeypatch):
    """R2 HEAD/LIST/DELETE without a network: every object exists, deletes succeed."""
    from utils.r2 import R2

    monkeypatch.setattr(R2, "head", lambda self, key: 1234)
    monkeypatch.setattr(R2, "delete_prefix", lambda self, prefix: 0)
