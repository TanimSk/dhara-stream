import logging
import re
import time

from django.conf import settings
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.views import APIView

from administrator.permissions import IsClientUser
from utils.r2 import R2, R2Error
from utils.shared import fail, ok, paginate
from utils.tokens import sign_playback

from . import hls
from .models import Category, Video
from .serializers import (
    CategorySerializer,
    CompleteSerializer,
    UploadUrlsSerializer,
    VideoCreateSerializer,
    VideoSerializer,
)

log = logging.getLogger("dhara")

HLS_PATH = re.compile(r"^(thumb\.jpg|(\d{3,4})p/(index\.m3u8|seg_\d{5}\.ts))$")
MP4_PATH = re.compile(r"^(thumb\.jpg|video\.mp4)$")


def client_r2(client):
    b = getattr(client, "bucket", None)
    return R2.for_bucket(b) if b and b.is_ready else None


# ---------------- categories ----------------


class CategoryListView(APIView):
    permission_classes = [IsClientUser]

    def get(self, request):
        qs = request.client.categories.annotate(video_count=Count("videos", filter=Q(videos__status="ready")))
        return ok(results=CategorySerializer(qs, many=True).data)

    def post(self, request):
        s = CategorySerializer(data=request.data, context={"client": request.client})
        s.is_valid(raise_exception=True)
        s.save(client=request.client)
        return ok("Category created", 201, category=s.data)


class CategoryDetailView(APIView):
    permission_classes = [IsClientUser]

    def get_object(self, request, pk):
        return get_object_or_404(Category, pk=pk, client=request.client)

    def patch(self, request, pk):
        s = CategorySerializer(self.get_object(request, pk), data=request.data, partial=True,
                               context={"client": request.client})
        s.is_valid(raise_exception=True)
        s.save()
        return ok("Category updated", category=s.data)

    def delete(self, request, pk):
        self.get_object(request, pk).delete()  # videos stay, uncategorized
        return ok("Category deleted")


# ---------------- videos ----------------


class VideoListView(APIView):
    permission_classes = [IsClientUser]

    def get(self, request):
        qs = request.client.videos.select_related("category")
        p = request.query_params
        if c := p.get("category"):
            qs = qs.filter(category__isnull=True) if c == "none" else qs.filter(category_id=c)
        if v := p.get("visibility"):
            qs = qs.filter(visibility=v)
        if st := p.get("status"):
            qs = qs.filter(status=st)
        if q := p.get("q"):
            qs = qs.filter(title__icontains=q)
        ctx = {"client": request.client, "r2": client_r2(request.client)}
        return paginate(self, request, qs, VideoSerializer, context=ctx)

    def post(self, request):
        r2 = client_r2(request.client)
        if r2 is None:
            return fail("Your storage bucket isn't ready yet. Contact the platform admin.", 409)
        s = VideoCreateSerializer(data=request.data, context={"client": request.client})
        s.is_valid(raise_exception=True)
        video = s.save(client=request.client)
        return ok(
            "Upload started", 201,
            video=VideoSerializer(video, context={"client": request.client}).data,
            upload=upload_info(video),
        )


def upload_info(video):
    """What an uploader needs to encrypt and lay out files. Only returned while uploading."""
    return {
        "key_hex": video.aes_key,
        "key_uri": hls.KEY_URI,
        "segment_seconds": 6,
        "allowed_heights": settings.ALLOWED_HEIGHTS,
        "layout": {
            "hls": ["thumb.jpg", "{height}p/index.m3u8", "{height}p/seg_00001.ts"],
            "mp4": ["thumb.jpg", "video.mp4"],
        }[video.source],
    }


class VideoDetailView(APIView):
    permission_classes = [IsClientUser]

    def get_object(self, request, pk):
        return get_object_or_404(Video.objects.select_related("category"), pk=pk, client=request.client)

    def get(self, request, pk):
        ctx = {"client": request.client, "r2": client_r2(request.client)}
        return ok(video=VideoSerializer(self.get_object(request, pk), context=ctx).data)

    def patch(self, request, pk):
        s = VideoSerializer(self.get_object(request, pk), data=request.data, partial=True,
                            context={"client": request.client, "r2": client_r2(request.client)})
        s.is_valid(raise_exception=True)
        s.save()
        return ok("Video updated", video=s.data)

    def delete(self, request, pk):
        video = self.get_object(request, pk)
        r2 = client_r2(request.client)
        if r2:
            try:
                r2.delete_prefix(video.prefix)
            except R2Error as exc:
                log.warning("could not delete objects for video %s: %s", video.id, exc)
                return fail("Storage didn't respond; try deleting again in a minute.", 502)
        video.delete()
        return ok("Video deleted")


class UploadingMixin:
    def get_uploading(self, request, pk):
        video = get_object_or_404(Video, pk=pk, client=request.client)
        if video.status != Video.Status.UPLOADING:
            return video, fail("This video isn't accepting uploads.", 409)
        r2 = client_r2(request.client)
        if r2 is None:
            return video, fail("Storage bucket isn't ready.", 409)
        return video, r2


class UploadKeyView(UploadingMixin, APIView):
    """Re-fetch the content key to resume an interrupted transcode."""

    permission_classes = [IsClientUser]

    def get(self, request, pk):
        video, r2 = self.get_uploading(request, pk)
        if not isinstance(r2, R2):
            return r2
        return ok(upload=upload_info(video))


class UploadUrlsView(UploadingMixin, APIView):
    permission_classes = [IsClientUser]

    def post(self, request, pk):
        video, r2 = self.get_uploading(request, pk)
        if not isinstance(r2, R2):
            return r2
        s = UploadUrlsSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        pattern = HLS_PATH if video.source == Video.Source.HLS else MP4_PATH
        urls = {}
        for path in s.validated_data["files"]:
            m = pattern.match(path)
            if not m or (video.source == Video.Source.HLS and m.group(2) and int(m.group(2)) not in settings.ALLOWED_HEIGHTS):
                return fail(f"Path not allowed: {path}")
            urls[path] = r2.presign("PUT", f"{video.id}/{path}", settings.UPLOAD_URL_TTL)
        return ok(urls=urls, expires_in=settings.UPLOAD_URL_TTL)


class UploadCompleteView(UploadingMixin, APIView):
    permission_classes = [IsClientUser]

    def post(self, request, pk):
        video, r2 = self.get_uploading(request, pk)
        if not isinstance(r2, R2):
            return r2
        s = CompleteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data

        playlists, renditions, checks = {}, [], []
        if video.source == Video.Source.HLS:
            if not d["renditions"]:
                return fail("At least one quality is required.")
            for r in d["renditions"]:
                try:
                    text, segments = hls.validate_variant(r["playlist"])
                except ValueError as exc:
                    return fail(f"{r['height']}p playlist: {exc}")
                playlists[str(r["height"])] = text
                renditions.append({
                    "height": r["height"], "width": r["width"], "pixel_height": r.get("pixel_height") or r["height"],
                    "bandwidth": r["bandwidth"], "codecs": r["codecs"], "segments": len(segments),
                })
                checks.append(f"{video.id}/{r['height']}p/{segments[-1]}")
        else:
            checks.append(f"{video.id}/video.mp4")

        # Proof the upload finished: the last segment of every quality (or the MP4) exists.
        try:
            sizes = [r2.head(k) for k in checks]
        except R2Error as exc:
            log.warning("complete check failed for %s: %s", video.id, exc)
            return fail("Couldn't reach storage to verify the upload. Try again.", 502)
        missing = [k.split("/", 1)[1] for k, size in zip(checks, sizes) if size is None]
        if missing:
            return fail(f"These files haven't been uploaded yet: {', '.join(missing)}", 409)

        video.duration, video.width, video.height = d["duration"], d["width"], d["height"]
        video.size_bytes = d["size_bytes"] or (sizes[0] if video.source == Video.Source.MP4 else 0)
        video.has_thumbnail = d["has_thumbnail"]
        video.renditions, video.playlists = renditions, playlists
        video.status, video.ready_at = Video.Status.READY, timezone.now()
        video.save()
        return ok("Video is ready", video=VideoSerializer(video, context={"client": request.client, "r2": r2}).data)


class UploadFailView(APIView):
    permission_classes = [IsClientUser]

    def post(self, request, pk):
        video = get_object_or_404(Video, pk=pk, client=request.client, status=Video.Status.UPLOADING)
        video.status = Video.Status.FAILED
        video.save(update_fields=["status", "updated_at"])
        return ok("Upload marked as failed")


class EmbedInfoView(APIView):
    """Embed code for the dashboard, plus a 2-hour preview link (private videos included)."""

    permission_classes = [IsClientUser]

    def get(self, request, pk):
        video = get_object_or_404(Video.objects.select_related("category"), pk=pk, client=request.client)
        base = f"{settings.PLAYER_ORIGIN}/embed/{video.id}"
        exp = int(time.time()) + 7200
        preview = f"{base}?token={sign_playback(request.client.api_secret, video.id, exp)}&exp={exp}"
        iframe_src = f"{base}?token=TOKEN&exp=EXP" if video.is_private else base
        iframe = (
            f'<div style="position:relative;padding-top:56.25%"><iframe src="{iframe_src}" '
            'style="position:absolute;inset:0;width:100%;height:100%;border:0" '
            'allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe></div>'
        )
        return ok(embed_url=base, preview_url=preview, iframe=iframe, private=video.is_private,
                  key_id=request.client.api_key_id)
