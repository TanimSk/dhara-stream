"""Master admin API: manage clients, their logins and their R2 buckets."""

import secrets

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView

from clients import provisioning
from clients.models import Client
from library.models import Video
from utils.shared import ok, paginate

from .models import User
from .permissions import IsMaster
from .serializers import (
    AdminClientCreateSerializer,
    AdminClientSerializer,
    BucketSerializer,
    ManualBucketSerializer,
)


def _clients():
    ready = Q(videos__status=Video.Status.READY)
    return Client.objects.select_related("bucket").annotate(
        video_count=Count("videos", filter=ready),
        storage_bytes=Coalesce(Sum("videos__size_bytes", filter=ready), 0),
    )


class OverviewView(APIView):
    permission_classes = [IsMaster]

    def get(self, request):
        ready = Video.objects.filter(status=Video.Status.READY)
        return ok(
            clients=Client.objects.count(),
            active_clients=Client.objects.filter(status=Client.Status.ACTIVE).count(),
            videos=ready.count(),
            storage_bytes=ready.aggregate(s=Coalesce(Sum("size_bytes"), 0))["s"],
            hours=round((ready.aggregate(s=Coalesce(Sum("duration"), 0.0))["s"]) / 3600, 1),
            buckets_failed=Client.objects.filter(bucket__status="failed").count(),
        )


class ClientListView(APIView):
    permission_classes = [IsMaster]

    def get(self, request):
        qs = _clients()
        if q := request.query_params.get("q"):
            qs = qs.filter(Q(name__icontains=q) | Q(users__email__icontains=q)).distinct()
        if status := request.query_params.get("status"):
            qs = qs.filter(status=status)
        return paginate(self, request, qs, AdminClientSerializer)

    def post(self, request):
        s = AdminClientCreateSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        password = d.get("password") or secrets.token_urlsafe(12)
        with transaction.atomic():
            client = Client.objects.create(
                name=d["name"], slug=Client.unique_slug(d["name"]),
                allowed_domains=d["allowed_domains"], notes=d["notes"],
            )
            User.objects.create_user(d["email"], password, role=User.Role.CLIENT, client=client, name=d["name"])
        # Outside the transaction: a Cloudflare failure must not roll back the client.
        provisioning.provision(client)
        data = AdminClientSerializer(_clients().get(pk=client.pk)).data
        return ok("Client created", 201, client=data, password=password if not d.get("password") else None)


class ClientDetailView(APIView):
    permission_classes = [IsMaster]

    def get(self, request, pk):
        return ok(client=AdminClientSerializer(get_object_or_404(_clients(), pk=pk)).data)

    def patch(self, request, pk):
        client = get_object_or_404(Client, pk=pk)
        s = AdminClientSerializer(client, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return ok("Client updated", client=AdminClientSerializer(_clients().get(pk=pk)).data)

    def delete(self, request, pk):
        client = get_object_or_404(Client, pk=pk)
        warnings = provisioning.teardown(client)
        client.delete()
        return ok("Client deleted", warnings=warnings)


class ClientProvisionView(APIView):
    permission_classes = [IsMaster]

    def post(self, request, pk):
        bucket = provisioning.provision(get_object_or_404(Client, pk=pk))
        return ok("Bucket ready" if bucket.is_ready else "Provisioning failed", bucket=BucketSerializer(bucket).data)


class ClientBucketView(APIView):
    """Enter bucket credentials by hand (when auto-provisioning isn't possible)."""

    permission_classes = [IsMaster]

    def put(self, request, pk):
        client = get_object_or_404(Client, pk=pk)
        s = ManualBucketSerializer(data=request.data, context={"client": client})
        s.is_valid(raise_exception=True)
        bucket = provisioning.set_manual(client, **s.validated_data)
        return ok("Bucket saved", bucket=BucketSerializer(bucket).data)


class ClientPasswordResetView(APIView):
    permission_classes = [IsMaster]

    def post(self, request, pk):
        client = get_object_or_404(Client, pk=pk)
        user = client.users.order_by("id").first()
        if user is None:
            return ok("This client has no login", password=None)
        password = secrets.token_urlsafe(12)
        user.set_password(password)
        user.save(update_fields=["password"])
        return ok("Password reset", email=user.email, password=password)
