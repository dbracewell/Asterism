"""Provider type enums and base-URL normalization shared by schemas, models, and discovery."""

from enum import StrEnum
from urllib.parse import urlsplit, urlunsplit

from pydantic_core import PydanticCustomError

# Pinned first-party endpoint; client-supplied URLs are ignored for OPENAI providers.
OPENAI_BASE_URL = "https://api.openai.com/v1"


class ProviderType(StrEnum):
    """Supported provider flavors.

    ``OPENAI`` is the first-party API (base URL pinned server-side);
    ``GENERIC_OPENAI`` is any OpenAI-compatible endpoint (public or local) with
    a client-supplied base URL. ``CHATGPT`` is one user's own ChatGPT plan
    (pinned to the OpenAI API, authorized by that user's connection); it is
    never admin-managed.
    """

    OPENAI = "openai"
    GENERIC_OPENAI = "generic_openai"
    CHATGPT = "chatgpt"


class ModelCapabilitySource(StrEnum):
    """Provenance of a model capability value (context window, vision, tools)."""

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
    if provider_type in (ProviderType.OPENAI, ProviderType.CHATGPT):
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

    # urlsplit strips brackets from IPv6 hostnames; restore them for reassembly.
    hostname = parsed.hostname.lower()
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    netloc = hostname
    if port is not None:
        netloc = f"{netloc}:{port}"

    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme.lower(), netloc, path, "", ""))
