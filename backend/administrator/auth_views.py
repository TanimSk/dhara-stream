from django.conf import settings
from django.contrib.auth import authenticate
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from utils.shared import fail, ok

from .serializers import LoginSerializer, PasswordChangeSerializer, UserSerializer


class AuthThrottle(AnonRateThrottle):
    scope = "auth"


def _set_cookie(response, refresh: str):
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME, refresh,
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        path=settings.REFRESH_COOKIE_PATH, secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True, samesite="Strict",
    )


def _tokens_response(user, device: str, message="Signed in"):
    refresh = RefreshToken.for_user(user)
    data = {"access": str(refresh.access_token), "user": UserSerializer(user).data}
    if device == "desktop":
        data["refresh"] = str(refresh)
    response = ok(message, **data)
    if device == "web":
        _set_cookie(response, str(refresh))
    return response


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [AuthThrottle]

    def post(self, request):
        s = LoginSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = authenticate(request, email=s.validated_data["email"].lower(), password=s.validated_data["password"])
        if user is None or not user.is_active:
            return fail("Email or password is incorrect.", 401)
        return _tokens_response(user, s.validated_data["device"])


class RefreshView(APIView):
    """Web sends the httpOnly cookie; the desktop app sends {"refresh": "..."}."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [AuthThrottle]

    def post(self, request):
        from_body = "refresh" in request.data
        raw = request.data.get("refresh") if from_body else request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not raw:
            return fail("Not signed in.", 401)
        try:
            old = RefreshToken(raw)
            from administrator.models import User

            user = User.objects.filter(id=old["user_id"], is_active=True).first()
            if user is None:
                return fail("Not signed in.", 401)
            old.blacklist()
        except TokenError:
            response = fail("Session expired. Sign in again.", 401)
            response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH)
            return response
        return _tokens_response(user, "desktop" if from_body else "web", message="Refreshed")


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw = request.data.get("refresh") or request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass
        response = ok("Signed out")
        response.delete_cookie(settings.REFRESH_COOKIE_NAME, path=settings.REFRESH_COOKIE_PATH)
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return ok(user=UserSerializer(request.user).data)


class PasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        s = PasswordChangeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        if not request.user.check_password(s.validated_data["current_password"]):
            return fail("Current password is incorrect.")
        request.user.set_password(s.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return ok("Password changed")
