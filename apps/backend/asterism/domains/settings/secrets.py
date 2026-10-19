import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from asterism.core.config import config

REDACTED_SECRET = "**********"
_ENCRYPTED_PREFIX = "enc:v1:"
_SECRET_KEY_SUFFIXES = ("_api_key", "_secret", "_token", "_password")
_SECRET_KEY_NAMES = {"api_key", "secret", "token", "password"}


def _fernet() -> Fernet:
    key_material = (config.system_key or "asterism-default-key").encode("utf-8")
    digest = hashlib.sha256(key_material).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    if not value or value.startswith(_ENCRYPTED_PREFIX):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{_ENCRYPTED_PREFIX}{token}"


def decrypt_secret(value: str) -> str:
    if not value or not value.startswith(_ENCRYPTED_PREFIX):
        return value
    token = value[len(_ENCRYPTED_PREFIX) :]
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return value


def is_secret_parameter_key(key: str) -> bool:
    normalized = key.strip().lower()
    return normalized in _SECRET_KEY_NAMES or normalized.endswith(_SECRET_KEY_SUFFIXES)


def redact_component_parameters(parameters: dict[str, str]) -> dict[str, str]:
    return {k: (REDACTED_SECRET if is_secret_parameter_key(k) and v else v) for k, v in parameters.items()}


def encrypt_component_provider_dict(
    provider_dict: dict[str, Any] | None,
    existing_dict: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
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
