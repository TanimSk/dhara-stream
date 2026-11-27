"""Encryption at rest for secrets stored in Postgres (R2 keys, API secrets, AES content keys)."""

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


@lru_cache(maxsize=1)
def _fernet():
    key = settings.FERNET_KEY
    if not key:
        # Development only (settings refuses to start without FERNET_KEY when DEBUG is off).
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("Stored secret could not be decrypted; check FERNET_KEY") from exc


class EncryptedTextField(models.TextField):
    """Transparently encrypts on save and decrypts on load. Empty strings stay empty."""

    def from_db_value(self, value, expression, connection):
        if not value:
            return value
        return decrypt(value)

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if not value:
            return value
        return encrypt(value)
