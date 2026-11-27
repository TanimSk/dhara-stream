from django.urls import path

from . import views

urlpatterns = [
    path("account", views.AccountView.as_view()),
    path("account/api-key", views.ApiKeyView.as_view()),
    path("account/api-key/rotate", views.ApiKeyRotateView.as_view()),
    path("playback-token", views.PlaybackTokenView.as_view()),
]
