"""Local development data: a master admin and a demo client whose bucket points at dev/fake_r2.py."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from administrator.models import User
from clients import provisioning
from clients.models import Client

PASSWORD = "dhara-dev-123"


class Command(BaseCommand):
    help = "Create dev users and a demo client (DEBUG only)."

    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError("dev_seed only runs with DEBUG on")
        if not User.objects.filter(email="admin@dhara.local").exists():
            User.objects.create_superuser("admin@dhara.local", PASSWORD, name="Platform admin")
        client = Client.objects.filter(slug="demo").first()
        if client is None:
            client = Client.objects.create(name="Demo School", slug="demo", allowed_domains=["localhost:5500", "127.0.0.1:5500"])
            User.objects.create_user("demo@dhara.local", PASSWORD, role=User.Role.CLIENT, client=client, name="Demo School")
        provisioning.set_manual(client, name="dev-demo", account_id="0" * 32, access_key_id="devkey", secret_access_key="devsecret")
        self.stdout.write(self.style.SUCCESS(
            f"master: admin@dhara.local / {PASSWORD}\nclient: demo@dhara.local / {PASSWORD}\n"
            f"demo API key id: {client.api_key_id}"
        ))
