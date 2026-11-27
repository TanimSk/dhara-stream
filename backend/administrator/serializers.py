from django.contrib.auth import password_validation
from rest_framework import serializers

from clients.models import Client, R2Bucket
from utils.domains import normalize_pattern

from .models import User


class UserSerializer(serializers.ModelSerializer):
    client = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "name", "role", "client"]
        read_only_fields = fields

    def get_client(self, obj):
        if not obj.client_id:
            return None
        c = obj.client
        return {"id": c.id, "name": c.name, "slug": c.slug, "status": c.status}


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)
    # "desktop" returns the refresh token in the body (kept in the OS keychain) instead of a cookie.
    device = serializers.ChoiceField(choices=["web", "desktop"], default="web")


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False, min_length=8)

    def validate_new_password(self, value):
        password_validation.validate_password(value)
        return value


def clean_domains(values):
    out = []
    for v in values or []:
        try:
            d = normalize_pattern(str(v))
        except ValueError as exc:
            raise serializers.ValidationError(str(exc))
        if d not in out:
            out.append(d)
    if len(out) > 50:
        raise serializers.ValidationError("At most 50 domains.")
    return out


class BucketSerializer(serializers.ModelSerializer):
    class Meta:
        model = R2Bucket
        fields = ["name", "account_id", "access_key_id", "manual", "status", "error", "created_at"]
        read_only_fields = fields


class AdminClientSerializer(serializers.ModelSerializer):
    bucket = BucketSerializer(read_only=True)
    owner_email = serializers.SerializerMethodField()
    video_count = serializers.IntegerField(read_only=True)
    storage_bytes = serializers.IntegerField(read_only=True)

    class Meta:
        model = Client
        fields = [
            "id", "name", "slug", "status", "allowed_domains", "allow_direct", "api_key_id", "notes",
            "created_at", "bucket", "owner_email", "video_count", "storage_bytes",
        ]
        read_only_fields = ["id", "slug", "api_key_id", "created_at", "bucket", "owner_email"]

    def get_owner_email(self, obj):
        u = obj.users.order_by("id").first()
        return u.email if u else None

    def validate_allowed_domains(self, value):
        return clean_domains(value)


class AdminClientCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    email = serializers.EmailField()
    # Leave empty to generate one; it's shown once in the response.
    password = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, min_length=8)
    allowed_domains = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_email(self, value):
        value = value.lower()
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_allowed_domains(self, value):
        return clean_domains(value)


class ManualBucketSerializer(serializers.Serializer):
    name = serializers.RegexField(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
    account_id = serializers.RegexField(r"^[a-f0-9]{32}$")
    access_key_id = serializers.CharField(max_length=128)
    secret_access_key = serializers.CharField(max_length=256, trim_whitespace=True)

    def validate_name(self, value):
        client = self.context.get("client")
        if R2Bucket.objects.filter(name=value).exclude(client=client).exists():
            raise serializers.ValidationError("Another client already uses this bucket.")
        return value
