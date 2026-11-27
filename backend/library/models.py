import secrets
import uuid

from django.db import models

from utils.crypto import EncryptedTextField


class Visibility(models.TextChoices):
    PUBLIC = "public", "Public"
    PRIVATE = "private", "Private"


class Category(models.Model):
    client = models.ForeignKey("clients.Client", on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    visibility = models.CharField(max_length=8, choices=Visibility.choices, default=Visibility.PUBLIC)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["client", "name"], name="uniq_category_name_per_client")]

    def __str__(self):
        return self.name


def new_aes_key():
    return secrets.token_hex(16)


class Video(models.Model):
    class Status(models.TextChoices):
        UPLOADING = "uploading", "Uploading"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    class Source(models.TextChoices):
        HLS = "hls", "HLS (encrypted)"
        MP4 = "mp4", "MP4 (single file)"

    class Via(models.TextChoices):
        DESKTOP = "desktop", "Desktop app"
        WEB = "web", "Web"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client = models.ForeignKey("clients.Client", on_delete=models.CASCADE, related_name="videos")
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="videos")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    visibility = models.CharField(max_length=8, choices=Visibility.choices, default=Visibility.PUBLIC)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.UPLOADING)
    source = models.CharField(max_length=4, choices=Source.choices, default=Source.HLS)
    uploaded_via = models.CharField(max_length=8, choices=Via.choices, default=Via.DESKTOP)
    original_filename = models.CharField(max_length=255, blank=True)

    duration = models.FloatField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    size_bytes = models.BigIntegerField(default=0)
    has_thumbnail = models.BooleanField(default=False)
    # [{"height": 720, "width": 1280, "bandwidth": 2800000, "codecs": "avc1.64001f,mp4a.40.2", "segments": 120}]
    renditions = models.JSONField(default=list, blank=True)
    # Validated variant playlists keyed by height ("720": "#EXTM3U..."); served by the gate, never from R2.
    playlists = models.JSONField(default=dict, blank=True)
    # AES-128 content key (hex). Only the gate's key endpoint serves it.
    aes_key = EncryptedTextField(default=new_aes_key)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    ready_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["client", "-created_at"])]

    def __str__(self):
        return self.title

    @property
    def is_private(self):
        return self.visibility == Visibility.PRIVATE or bool(
            self.category_id and self.category.visibility == Visibility.PRIVATE
        )

    @property
    def prefix(self):
        return f"{self.id}/"
