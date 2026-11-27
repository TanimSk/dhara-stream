"""
Django settings for dhara.

Every secret and environment-specific value comes from environment variables
(loaded from backend/.env in development). See .env.example for the full list.
"""

from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


SECRET_KEY = os.getenv("SECRET_KEY", "")
DEBUG = env_bool("DEBUG", False)
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("SECRET_KEY must be set when DEBUG is off")
    SECRET_KEY = "dev-insecure-secret-key-change-me"

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

############################ dhara platform ############################

# Where the dashboard (landing + both portals) is served, e.g. https://dhara.app
DASHBOARD_ORIGIN = os.getenv("DASHBOARD_ORIGIN", "http://localhost:5173").rstrip("/")
# Where the embed player and the playback gate (/embed, /v, /k) are served, e.g. https://play.dhara.app
PLAYER_ORIGIN = os.getenv("PLAYER_ORIGIN", "http://localhost:8000").rstrip("/")
# The desktop app's renderer origin (custom protocol), allowed to call the API cross-origin.
DESKTOP_ORIGIN = os.getenv("DESKTOP_ORIGIN", "app://dhara").rstrip("/")

DASHBOARD_HOST = urlparse(DASHBOARD_ORIGIN).netloc.lower()
PLAYER_HOST = urlparse(PLAYER_ORIGIN).netloc.lower()

# Encrypts R2 secrets, client API secrets and AES content keys at rest (Fernet, urlsafe base64, 32 bytes).
FERNET_KEY = os.getenv("FERNET_KEY", "")
if not FERNET_KEY and not DEBUG:
    raise RuntimeError("FERNET_KEY must be set when DEBUG is off")

# Cloudflare account that owns every client bucket. The API token needs
# "Workers R2 Storage: Edit" and "Account API Tokens: Edit" on that account.
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
CF_API_TOKEN = os.getenv("CF_API_TOKEN", "")
R2_BUCKET_PREFIX = os.getenv("R2_BUCKET_PREFIX", "dhara-")
# Optional override (e.g. a local S3-compatible server in development).
R2_ENDPOINT_OVERRIDE = os.getenv("R2_ENDPOINT_OVERRIDE", "").rstrip("/")

# Playback gate timings (seconds).
PLAYBACK_SESSION_TTL = int(os.getenv("PLAYBACK_SESSION_TTL", str(4 * 3600)))
SEGMENT_URL_TTL = int(os.getenv("SEGMENT_URL_TTL", str(6 * 3600)))
UPLOAD_URL_TTL = int(os.getenv("UPLOAD_URL_TTL", str(6 * 3600)))
THUMBNAIL_URL_TTL = int(os.getenv("THUMBNAIL_URL_TTL", str(6 * 3600)))
# Longest lifetime a client may give a playback token.
MAX_PLAYBACK_TOKEN_TTL = int(os.getenv("MAX_PLAYBACK_TOKEN_TTL", str(7 * 24 * 3600)))

ALLOWED_HEIGHTS = (240, 360, 480, 720, 1080, 1440, 2160)
MAX_PRESIGN_BATCH = 200

# Static player assets (hls.min.js). nginx serves STATIC_ROOT in production.
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]

############################ Django ############################

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "administrator.apps.AdministratorConfig",
    "clients.apps.ClientsConfig",
    "library.apps.LibraryConfig",
    "playback.apps.PlaybackConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "server.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

WSGI_APPLICATION = "server.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME", "dhara_stream"),
        "USER": os.getenv("DB_USER", ""),
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST": os.getenv("DB_HOST", ""),
        "PORT": os.getenv("DB_PORT", ""),
        # Keep connections open between requests: saves a Postgres handshake per playlist hit.
        "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
        "CONN_HEALTH_CHECKS": True,
    },
}

AUTH_USER_MODEL = "administrator.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

# CORS: the dashboard is same-origin with the API behind nginx (and the Vite proxy in dev);
# only the desktop app and explicitly configured origins call cross-origin.
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS") + [DESKTOP_ORIGIN]
CORS_URLS_REGEX = r"^/api/.*$"
CORS_ALLOW_CREDENTIALS = False

############################ DRF / JWT ############################

REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "utils.shared.custom_exception_handler",
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "DEFAULT_PARSER_CLASSES": ("rest_framework.parsers.JSONParser",),
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_THROTTLE_RATES": {"auth": "20/min", "api_key": "600/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# Web: the refresh token lives in an httpOnly cookie scoped to the auth endpoints.
# Desktop: the refresh token is returned in the body and kept in the OS keychain.
REFRESH_COOKIE_NAME = "dhara_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth/"
REFRESH_COOKIE_SECURE = env_bool("REFRESH_COOKIE_SECURE", not DEBUG)

############################ misc ############################

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

if not DEBUG:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "0"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {
        "dhara": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
        "django.request": {"handlers": ["console"], "level": "WARNING"},
    },
}
