from django.urls import path

from . import admin_views, auth_views

urlpatterns = [
    path("auth/login", auth_views.LoginView.as_view()),
    path("auth/refresh", auth_views.RefreshView.as_view()),
    path("auth/logout", auth_views.LogoutView.as_view()),
    path("auth/me", auth_views.MeView.as_view()),
    path("auth/password", auth_views.PasswordView.as_view()),
    path("admin/overview", admin_views.OverviewView.as_view()),
    path("admin/clients", admin_views.ClientListView.as_view()),
    path("admin/clients/<int:pk>", admin_views.ClientDetailView.as_view()),
    path("admin/clients/<int:pk>/provision", admin_views.ClientProvisionView.as_view()),
    path("admin/clients/<int:pk>/bucket", admin_views.ClientBucketView.as_view()),
    path("admin/clients/<int:pk>/reset-password", admin_views.ClientPasswordResetView.as_view()),
]
