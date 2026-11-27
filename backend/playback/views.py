"""
The playback gate (served on PLAYER_ORIGIN). Video bytes never pass through here:

  /embed/<video>?token&exp   checks domain + token, renders the player with a signed session
  /v/<session>/master.m3u8   master playlist (built from the stored renditions)
  /v/<session>/<h>.m3u8      variant playlist; segment lines become presigned R2 URLs
  /v/<session>/key           the AES-128 key
  /v/<session>/video.mp4     302 to a presigned R2 URL (single-file uploads)
"""

import html
import json
import logging
from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpResponse, HttpResponseRedirect
from django.views.decorators.clickjacking import xframe_options_exempt
from django.views.decorators.http import require_safe

from library import hls
from library.models import Video
from utils.domains import embed_allowed, frame_ancestors, requester_host
from utils.r2 import R2
from utils.tokens import make_session, read_session, verify_playback

log = logging.getLogger("dhara")
PAGES = Path(__file__).parent / "pages"
PLAYER_HTML = (PAGES / "player.html").read_text()
MESSAGE_HTML = (PAGES / "message.html").read_text()
M3U8 = "application/vnd.apple.mpegurl"
NO_STORE = "private, no-store"


def _message(title, body, status, headers=None):
    page = MESSAGE_HTML.replace("__DHARA_TITLE__", html.escape(title)).replace("__DHARA_BODY__", html.escape(body))
    r = HttpResponse(page, status=status, content_type="text/html; charset=utf-8")
    r["Cache-Control"] = NO_STORE
    for k, v in (headers or {}).items():
        r[k] = v
    return r


def _player(video, hls_url, poster, autoplay, start, headers):
    config = json.dumps({
        "hls": hls_url, "mp4": video.source == Video.Source.MP4, "resumeKey": f"dhara:{video.id}",
        "autoplay": autoplay, "start": start, "title": video.title,
    }).replace("<", "\\u003c")
    poster_attr = f'poster="{html.escape(poster)}"' if poster else ""
    page = (
        PLAYER_HTML.replace("__DHARA_CONFIG__", config)
        .replace("__DHARA_HLS_JS__", f"{settings.STATIC_URL}hls.min.js")
        .replace("__DHARA_POSTER_ATTR__", poster_attr)
        .replace("__DHARA_TITLE__", html.escape(video.title))
    )
    r = HttpResponse(page, content_type="text/html; charset=utf-8")
    for k, v in headers.items():
        r[k] = v
    return r


def _load(video_id):
    video = (
        Video.objects.select_related("client", "client__bucket", "category")
        .filter(id=video_id, status=Video.Status.READY)
        .first()
    )
    if video is None:
        return None, 404
    if not video.client.is_active:
        return video, 403
    bucket = getattr(video.client, "bucket", None)
    if not (bucket and bucket.is_ready):
        return video, 503
    return video, 200


@require_safe
@xframe_options_exempt  # framing is governed by CSP frame-ancestors below
def embed(request, video_id):
    video, status = _load(video_id)
    if status == 404:
        return _message("Video not found", "It may have been moved or deleted.", 404)
    if status == 403:
        return _message("This video is unavailable", "The publisher's account is paused.", 403)
    if status == 503:
        return _message("This video is unavailable", "Please try again later.", 503)

    client = video.client
    headers = {
        "Content-Security-Policy": f"frame-ancestors {frame_ancestors(client)}",
        "Cache-Control": NO_STORE,
        # Playlist and key requests carry our own origin as Referer; nothing leaks to R2.
        "Referrer-Policy": "same-origin",
        "X-Robots-Tag": "noindex",
    }
    host = requester_host(request)
    if not embed_allowed(host, client):
        return _message("Playback isn't allowed here",
                        "This video can only be watched on the publisher's website.", 403, headers)
    if video.is_private and not verify_playback(
        client.api_secret, video.id, request.GET.get("token"), request.GET.get("exp")
    ):
        return _message("This link has expired", "Reload the page you came from to get a fresh one.", 403, headers)

    session = make_session(video.id, host)
    r2 = R2.for_bucket(client.bucket)
    poster = r2.presign_get_shared(f"{video.id}/thumb.jpg", settings.THUMBNAIL_URL_TTL) if video.has_thumbnail else ""
    target = "video.mp4" if video.source == Video.Source.MP4 else "master.m3u8"
    try:
        start = max(0, int(float(request.GET.get("t", 0))))
    except ValueError:
        start = 0
    return _player(video, f"/v/{session}/{target}", poster, request.GET.get("autoplay") == "1", start, headers)


def _session_video(request, session):
    data = read_session(session)
    if data is None:
        return None, HttpResponse("Playback session expired", status=403, content_type="text/plain")
    # Only our own player page may fetch these. (Browsers on other sites are also stopped by the
    # missing CORS headers; this catches embeds of the raw playlist URL.)
    host = requester_host(request)
    if host is not None and host != settings.PLAYER_HOST:
        return None, HttpResponse("Forbidden", status=403, content_type="text/plain")
    video, status = _load(data["v"])
    if status != 200:
        return None, HttpResponse("Unavailable", status=status if status != 404 else 404, content_type="text/plain")
    return video, None


def _text(body, content_type=M3U8):
    r = HttpResponse(body, content_type=content_type)
    r["Cache-Control"] = NO_STORE
    return r


@require_safe
def master(request, session):
    video, err = _session_video(request, session)
    if err:
        return err
    if video.source != Video.Source.HLS:
        raise Http404
    return _text(hls.build_master(video.renditions))


@require_safe
def variant(request, session, height):
    video, err = _session_video(request, session)
    if err:
        return err
    if str(height) not in video.playlists:
        raise Http404
    return _text(hls.rewrite_variant(video, height, R2.for_bucket(video.client.bucket)))


@require_safe
def key(request, session):
    video, err = _session_video(request, session)
    if err:
        return err
    return _text(bytes.fromhex(video.aes_key), "application/octet-stream")


@require_safe
def mp4(request, session):
    video, err = _session_video(request, session)
    if err:
        return err
    if video.source != Video.Source.MP4:
        raise Http404
    url = R2.for_bucket(video.client.bucket).presign_get_shared(f"{video.id}/video.mp4", settings.SEGMENT_URL_TTL)
    r = HttpResponseRedirect(url)
    r["Cache-Control"] = NO_STORE
    return r


def health(request):
    return HttpResponse("ok", content_type="text/plain")
