"""Client account settings, API key, and the server-to-server playback-token endpoint."""

import hmac
import time

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from administrator.permissions import IsClientUser
from administrator.serializers import clean_domains
from library.models import Video
from utils.shared import fail, ok
from utils.tokens import sign_playback

from .models import Client


class AccountSerializer(serializers.ModelSerializer):
    bucket_status = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = ["id", "name", "slug", "status", "allowed_domains", "allow_direct", "api_key_id", "bucket_status"]
        read_only_fields = ["id", "name", "slug", "status", "api_key_id", "bucket_status"]

    def get_bucket_status(self, obj):
        b = getattr(obj, "bucket", None)
        return b.status if b else "missing"

    def validate_allowed_domains(self, value):
        return clean_domains(value)


class AccountView(APIView):
    permission_classes = [IsClientUser]

    def get(self, request):
        c = request.client
        stats = c.videos.aggregate(
            videos=Count("id", filter=Q(status=Video.Status.READY)),
            storage_bytes=Coalesce(Sum("size_bytes", filter=Q(status=Video.Status.READY)), 0),
            seconds=Coalesce(Sum("duration", filter=Q(status=Video.Status.READY)), 0.0),
            private=Count("id", filter=Q(status=Video.Status.READY, visibility="private")),
        )
        stats["categories"] = c.categories.count()
        return ok(account=AccountSerializer(c).data, stats=stats, player_origin=settings.PLAYER_ORIGIN)

    def patch(self, request):
        s = AccountSerializer(request.client, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return ok("Settings saved", account=s.data)


class ApiKeyView(APIView):
    """Reveal the playback API secret to the signed-in owner."""

    permission_classes = [IsClientUser]

    def get(self, request):
        return ok(key_id=request.client.api_key_id, secret=request.client.api_secret)


class ApiKeyRotateView(APIView):
    permission_classes = [IsClientUser]

    def post(self, request):
        request.client.rotate_secret()
        return ok("API secret rotated. Update it on your server.",
                  key_id=request.client.api_key_id, secret=request.client.api_secret)


class ApiKeyThrottle(SimpleRateThrottle):
    scope = "api_key"

    def get_cache_key(self, request, view):
        return f"throttle_api_key_{getattr(request, 'api_client_id', self.get_ident(request))}"


class PlaybackTokenRequest(serializers.Serializer):
    video_id = serializers.UUIDField()
    ttl = serializers.IntegerField(min_value=60, max_value=settings.MAX_PLAYBACK_TOKEN_TTL, default=7200)


class PlaybackTokenView(APIView):
    """
    Server-to-server convenience: `Authorization: ApiKey <key_id>:<secret>` and {"video_id", "ttl"}.
    Clients can also sign tokens locally (see docs) without calling this endpoint at all.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ApiKeyThrottle]

    def initial(self, request, *args, **kwargs):
        self.client = None
        header = request.headers.get("Authorization", "")
        if header.startswith("ApiKey ") and ":" in header:
            key_id, secret = header[7:].split(":", 1)
            c = Client.objects.filter(api_key_id=key_id.strip()).first()
            if c and hmac.compare_digest(c.api_secret, secret.strip()):
                self.client = c
                request.api_client_id = c.id
        super().initial(request, *args, **kwargs)

    def post(self, request):
        if self.client is None:
            return fail("Invalid API key.", 401)
        if not self.client.is_active:
            return fail("This account is suspended.", 403)
        s = PlaybackTokenRequest(data=request.data)
        s.is_valid(raise_exception=True)
        vid = s.validated_data["video_id"]
        if not Video.objects.filter(id=vid, client=self.client).exists():
            return fail("Video not found.", 404)
        exp = int(time.time()) + s.validated_data["ttl"]
        token = sign_playback(self.client.api_secret, vid, exp)
        return ok(
            token=token, exp=exp,
            embed_url=f"{settings.PLAYER_ORIGIN}/embed/{vid}?token={token}&exp={exp}",
        )
