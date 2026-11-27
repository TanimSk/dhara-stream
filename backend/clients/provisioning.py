"""Create (or retry) a client's R2 bucket through the Cloudflare API, and tear it down."""

import logging

from django.conf import settings

from utils import cloudflare
from utils.r2 import R2, R2Error

from .models import Client, R2Bucket

log = logging.getLogger("dhara")


def provision(client: Client) -> R2Bucket:
    bucket, _ = R2Bucket.objects.get_or_create(client=client, defaults={"name": R2Bucket.name_for(client)})
    if bucket.manual:
        return bucket
    if not cloudflare.configured():
        bucket.status = R2Bucket.Status.FAILED
        bucket.error = (
            "Cloudflare isn't configured on the server (CF_ACCOUNT_ID / CF_API_TOKEN). "
            "Set them and retry, or enter bucket credentials manually."
        )
        bucket.save()
        return bucket
    try:
        cloudflare.create_bucket(bucket.name)
        cloudflare.set_cors(bucket.name)
        if not (bucket.access_key_id and bucket.secret_access_key):
            token_id, key_id, secret = cloudflare.create_scoped_credentials(bucket.name)
            bucket.cf_token_id, bucket.access_key_id, bucket.secret_access_key = token_id, key_id, secret
        bucket.account_id = settings.CF_ACCOUNT_ID
        bucket.status, bucket.error = R2Bucket.Status.READY, ""
    except cloudflare.CloudflareError as exc:
        log.warning("bucket provisioning failed for client %s: %s", client.pk, exc)
        bucket.status, bucket.error = R2Bucket.Status.FAILED, str(exc)
    bucket.save()
    return bucket


def set_manual(client: Client, *, name, account_id, access_key_id, secret_access_key) -> R2Bucket:
    bucket, _ = R2Bucket.objects.get_or_create(client=client, defaults={"name": name})
    bucket.name, bucket.account_id = name, account_id
    bucket.access_key_id, bucket.secret_access_key = access_key_id, secret_access_key
    bucket.manual, bucket.cf_token_id = True, ""
    bucket.status, bucket.error = R2Bucket.Status.READY, ""
    bucket.save()
    return bucket


def teardown(client: Client) -> list[str]:
    """Best effort: empty and delete the bucket and revoke its token. Returns warnings."""
    warnings = []
    bucket = R2Bucket.objects.filter(client=client).first()
    if not bucket or not bucket.is_ready:
        return warnings
    try:
        r2 = R2.for_bucket(bucket)
        for video in client.videos.all():
            r2.delete_prefix(video.prefix)
    except R2Error as exc:
        warnings.append(f"Could not empty bucket {bucket.name}: {exc}")
    if not bucket.manual and cloudflare.configured():
        try:
            cloudflare.delete_bucket(bucket.name)
            cloudflare.delete_token(bucket.cf_token_id)
        except cloudflare.CloudflareError as exc:
            warnings.append(f"Cloudflare cleanup for {bucket.name} failed: {exc}")
    return warnings
