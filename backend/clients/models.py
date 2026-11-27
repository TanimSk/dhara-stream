import secrets

from django.conf import settings
from django.db import models
from django.utils.text import slugify

from utils.crypto import EncryptedTextField


def new_key_id():
    return "dk_" + secrets.token_hex(8)


def new_secret():
    return "dsk_" + secrets.token_urlsafe(32)


class Client(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"

    name = models.CharField(max_length=120)
    slug = models.SlugField(max_length=40, unique=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    # Sites allowed to embed this client's videos ("school.com", "*.school.com").
    allowed_domains = models.JSONField(default=list, blank=True)
    # Allow playback when the request carries no Origin/Referer (apps, direct links). Off by default.
    allow_direct = models.BooleanField(default=False)
    # Playback API key: the id is public, the secret signs playback tokens on the client's server.
    api_key_id = models.CharField(max_length=32, unique=True, default=new_key_id)
    api_secret = EncryptedTextField(default=new_secret)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    @property
    def is_active(self):
        return self.status == self.Status.ACTIVE

    def rotate_secret(self):
        self.api_secret = new_secret()
        self.save(update_fields=["api_secret"])

    @staticmethod
    def unique_slug(name: str) -> str:
        base = (slugify(name) or "client")[:28]
        slug, n = base, 1
        while Client.objects.filter(slug=slug).exists():
            n += 1
            slug = f"{base}-{n}"
        return slug


class R2Bucket(models.Model):
    """The client's own R2 bucket. Credentials stay on the server; clients only ever see presigned URLs."""

    class Status(models.TextChoices):
        PROVISIONING = "provisioning", "Provisioning"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    client = models.OneToOneField(Client, on_delete=models.CASCADE, related_name="bucket")
    name = models.CharField(max_length=63, unique=True)
    account_id = models.CharField(max_length=64, blank=True)
    access_key_id = models.CharField(max_length=128, blank=True)
    secret_access_key = EncryptedTextField(blank=True)
    cf_token_id = models.CharField(max_length=64, blank=True)
    # True when the admin pasted credentials instead of auto-provisioning.
    manual = models.BooleanField(default=False)
    status = models.CharField(max_length=14, choices=Status.choices, default=Status.PROVISIONING)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    @property
    def is_ready(self):
        return self.status == self.Status.READY

    @staticmethod
    def name_for(client: Client) -> str:
        return f"{settings.R2_BUCKET_PREFIX}{client.slug}"[:63]
