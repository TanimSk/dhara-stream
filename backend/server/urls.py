from django.urls import include, path

urlpatterns = [
    path("api/v1/", include("administrator.urls")),
    path("api/v1/", include("clients.urls")),
    path("api/v1/", include("library.urls")),
    path("", include("playback.urls")),
]
