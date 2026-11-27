from django.urls import path

from . import views

urlpatterns = [
    path("categories", views.CategoryListView.as_view()),
    path("categories/<int:pk>", views.CategoryDetailView.as_view()),
    path("videos", views.VideoListView.as_view()),
    path("videos/<uuid:pk>", views.VideoDetailView.as_view()),
    path("videos/<uuid:pk>/upload-key", views.UploadKeyView.as_view()),
    path("videos/<uuid:pk>/upload-urls", views.UploadUrlsView.as_view()),
    path("videos/<uuid:pk>/complete", views.UploadCompleteView.as_view()),
    path("videos/<uuid:pk>/fail", views.UploadFailView.as_view()),
    path("videos/<uuid:pk>/embed", views.EmbedInfoView.as_view()),
]
