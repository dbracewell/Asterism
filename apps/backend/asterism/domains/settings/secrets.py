"""Secret handling for settings: Fernet encryption at rest and response redaction.

Provider API keys use the :class:`EncryptedText` column type; component provider
parameters (e.g. search API keys) are encrypted inside JSON values by
:func:`encrypt_component_provider_dict`. Values stored with the ``enc:v1:``
prefix are Fernet tokens; anything else is treated as legacy plaintext and
passed through unchanged.
"""

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from asterism.common.log import get_logger
from asterism.core.config import config

logger = get_logger("SettingsSecrets")

# Coupling note: this value must equal Pydantic ``SecretStr``'s JSON redaction
# output ("**********"). The service layer compares incoming API keys against
# it to detect a client echoing back a redacted key (see ``service._provider_api_key``).
REDACTED_SECRET = "**********"
_ENCRYPTED_PREFIX = "enc:v1:"
_SECRET_KEY_SUFFIXES = ("_api_key", "_secret", "_token", "_password")
_SECRET_KEY_NAMES = {"api_key", "secret", "token", "password"}


def _fernet() -> Fernet:
    """Build a Fernet instance from the configured system key (SHA-256 derived).

    Raises:
        RuntimeError: When ``SYSTEM_KEY`` is unset. Falling back to a built-in
            key would encrypt secrets with material anyone can read, so any
            runtime that stores or reads encrypted settings must configure it.
    """
    if not config.system_key:
        raise RuntimeError(
            "SYSTEM_KEY is not configured; refusing to encrypt/decrypt settings secrets",
        )
    key_material = config.system_key.encode("utf-8")
    digest = hashlib.sha256(key_material).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    """Encrypt ``value`` and prefix it with the version marker.

    Empty values and already-encrypted values pass through unchanged so the
    function is idempotent on re-save.
    """
    if not value or value.startswith(_ENCRYPTED_PREFIX):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{_ENCRYPTED_PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    """Inverse of :func:`encrypt_secret`.

    Non-prefixed values (legacy plaintext) and undecryptable tokens are
    returned as-is, so a key-rotation mismatch surfaces as a bad credential
    rather than a crash. Undecryptable tokens are logged so the mismatch is
    visible in server logs instead of silent.
    """
    if not value or not value.startswith(_ENCRYPTED_PREFIX):
        return value
    token = value[len(_ENCRYPTED_PREFIX) :]
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning(
            "Stored secret could not be decrypted (key mismatch or corruption); returning the stored value unchanged",
            extra={"token_prefix": token[:16]},
        )
        return value


def is_secret_parameter_key(key: str) -> bool:
    """True for parameter names that conventionally hold credentials."""
    normalized = key.strip().lower()
    return normalized in _SECRET_KEY_NAMES or normalized.endswith(_SECRET_KEY_SUFFIXES)


def redact_component_parameters(parameters: dict[str, str]) -> dict[str, str]:
    """Replace the values of secret-looking keys with :data:`REDACTED_SECRET` (empty values stay empty)."""
    return {k: (REDACTED_SECRET if is_secret_parameter_key(k) and v else v) for k, v in parameters.items()}


def encrypt_component_provider_dict(
    provider_dict: dict[str, Any] | None,
    existing_dict: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Encrypt the secret parameters of a component-provider payload before storage.

    Args:
        provider_dict: The incoming ``{"name", "parameters"}`` payload (or None).
        existing_dict: The previously stored (still-encrypted) payload; used to
            carry over a real value when the client echoes back the redaction
            sentinel unchanged. Only consulted when the provider name matches.
    """
    if provider_dict is None:
        return None
    name = provider_dict.get("name")
    params = provider_dict.get("parameters")
    if not isinstance(params, dict):
        return provider_dict

    existing_params: dict[str, Any] = {}
    if isinstance(existing_dict, dict) and existing_dict.get("name") == name:
        raw_existing_params = existing_dict.get("parameters")
        if isinstance(raw_existing_params, dict):
            existing_params = raw_existing_params

    encrypted_params: dict[str, str] = {}
    for k, v in params.items():
        str_val = str(v) if v is not None else ""
        if is_secret_parameter_key(k):
            if str_val == REDACTED_SECRET and k in existing_params:
                existing_val = str(existing_params[k])
                encrypted_params[k] = encrypt_secret(decrypt_secret(existing_val))
            else:
                encrypted_params[k] = encrypt_secret(str_val)
        else:
            encrypted_params[k] = str_val

    return {
        **provider_dict,
        "parameters": encrypted_params,
    }


def decrypt_component_provider_dict(raw: Any) -> Any:
    """Inverse of :func:`encrypt_component_provider_dict` for stored JSON values."""
    if not isinstance(raw, dict):
        return raw
    params = raw.get("parameters")
    if not isinstance(params, dict):
        return raw
    decrypted_params = {
        k: (decrypt_secret(v) if isinstance(v, str) and is_secret_parameter_key(k) else v) for k, v in params.items()
    }
    return {
        **raw,
        "parameters": decrypted_params,
    }


class EncryptedText(TypeDecorator[str]):
    """SQLAlchemy column type that transparently encrypts secrets at rest."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return encrypt_secret(value)

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        if value is None:
            return None
        return decrypt_secret(value)
