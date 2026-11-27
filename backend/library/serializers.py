from django.conf import settings
from rest_framework import serializers

from .hls import CODECS_RE
from .models import Category, Video


class CategorySerializer(serializers.ModelSerializer):
    video_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Category
        fields = ["id", "name", "description", "visibility", "video_count", "created_at"]
        read_only_fields = ["id", "video_count", "created_at"]

    def validate_name(self, value):
        client = self.context["client"]
        qs = Category.objects.filter(client=client, name__iexact=value.strip())
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("You already have a category with this name.")
        return value.strip()


class CategoryField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        return Category.objects.filter(client=self.context["client"])


class VideoSerializer(serializers.ModelSerializer):
    category = CategoryField(allow_null=True, required=False)
    category_name = serializers.CharField(source="category.name", read_only=True, default=None)
    effective_visibility = serializers.SerializerMethodField()
    qualities = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Video
        fields = [
            "id", "title", "description", "visibility", "effective_visibility", "category", "category_name",
            "status", "source", "uploaded_via", "original_filename", "duration", "width", "height",
            "size_bytes", "qualities", "thumbnail_url", "created_at", "ready_at",
        ]
        read_only_fields = [
            "id", "effective_visibility", "category_name", "status", "source", "uploaded_via",
            "original_filename", "duration", "width", "height", "size_bytes", "qualities", "thumbnail_url",
            "created_at", "ready_at",
        ]

    def get_effective_visibility(self, obj):
        return "private" if obj.is_private else "public"

    def get_qualities(self, obj):
        return sorted((r["height"] for r in obj.renditions or []), reverse=True)

    def get_thumbnail_url(self, obj):
        r2 = self.context.get("r2")
        if not (r2 and obj.has_thumbnail):
            return None
        return r2.presign_get_shared(f"{obj.id}/thumb.jpg", settings.THUMBNAIL_URL_TTL)


class VideoCreateSerializer(serializers.ModelSerializer):
    category = CategoryField(allow_null=True, required=False)

    class Meta:
        model = Video
        fields = ["title", "description", "category", "visibility", "source", "uploaded_via", "original_filename"]


class UploadUrlsSerializer(serializers.Serializer):
    files = serializers.ListField(
        child=serializers.CharField(max_length=64), min_length=1, max_length=settings.MAX_PRESIGN_BATCH
    )


class RenditionSerializer(serializers.Serializer):
    # Quality label (the short side: a 1080x1920 portrait video is "1080p").
    height = serializers.ChoiceField(choices=settings.ALLOWED_HEIGHTS)
    # Real pixel size of this rendition.
    width = serializers.IntegerField(min_value=16, max_value=8192)
    pixel_height = serializers.IntegerField(min_value=16, max_value=8192, required=False)
    bandwidth = serializers.IntegerField(min_value=1000, max_value=200_000_000)
    codecs = serializers.CharField(required=False, allow_blank=True, default="")
    playlist = serializers.CharField(trim_whitespace=False)

    def validate_codecs(self, value):
        if value and not CODECS_RE.match(value):
            raise serializers.ValidationError("Invalid codecs string.")
        return value


class CompleteSerializer(serializers.Serializer):
    duration = serializers.FloatField(min_value=0.1, max_value=24 * 3600)
    width = serializers.IntegerField(min_value=16, max_value=8192)
    height = serializers.IntegerField(min_value=16, max_value=8192)
    size_bytes = serializers.IntegerField(min_value=0, required=False, default=0)
    has_thumbnail = serializers.BooleanField(default=False)
    renditions = RenditionSerializer(many=True, required=False, default=list)

    def validate_renditions(self, value):
        heights = [r["height"] for r in value]
        if len(heights) != len(set(heights)):
            raise serializers.ValidationError("Each quality may appear once.")
        return value
