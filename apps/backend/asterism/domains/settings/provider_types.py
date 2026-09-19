from enum import StrEnum
from urllib.parse import urlsplit, urlunsplit

from pydantic_core import PydanticCustomError

OPENAI_BASE_URL = "https://api.openai.com/v1"


class ProviderType(StrEnum):
    OPENAI = "openai"
    GENERIC_OPENAI = "generic_openai"


class ModelCapabilitySource(StrEnum):
    CATALOG = "catalog"
    PROVIDER = "provider"
    MANUAL = "manual"
    UNKNOWN = "unknown"


def normalize_provider_base_url(provider_type: ProviderType, base_url: str) -> str:
    """Return the runtime URL for a supported provider type.

    OpenAI's URL is controlled by Asterism. Generic OpenAI endpoints may be
    public or local, but must be absolute HTTP(S) URLs without credentials,
    query parameters, or fragments.
    """
    if provider_type == ProviderType.OPENAI:
        return OPENAI_BASE_URL

    value = base_url.strip()
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise PydanticCustomError(
            "provider_base_url",
            "Base URL must be a valid absolute HTTP(S) URL",
        ) from exc

    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise PydanticCustomError(
            "provider_base_url",
            "Base URL must be a valid absolute HTTP(S) URL",
        )
    if parsed.username is not None or parsed.password is not None:
        raise PydanticCustomError(
            "provider_base_url",
            "Base URL must not contain credentials",
        )
    if parsed.query or parsed.fragment:
        raise PydanticCustomError(
            "provider_base_url",
            "Base URL must not contain a query string or fragment",
        )

    hostname = parsed.hostname.lower()
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    netloc = hostname
    if port is not None:
        netloc = f"{netloc}:{port}"

    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme.lower(), netloc, path, "", ""))
