from django.urls import path, re_path

from . import views

SESSION = r"(?P<session>[A-Za-z0-9_\-:]{20,400})"

urlpatterns = [
    path("embed/<uuid:video_id>", views.embed),
    re_path(rf"^v/{SESSION}/master\.m3u8$", views.master),
    re_path(rf"^v/{SESSION}/(?P<height>\d{{3,4}})\.m3u8$", views.variant),
    re_path(rf"^v/{SESSION}/key$", views.key),
    re_path(rf"^v/{SESSION}/video\.mp4$", views.mp4),
    path("health", views.health),
]
