"""The services an OpenAI-compatible provider can be set up from (ADR-0086).

A ``generic_openai`` provider records which service it is (``providers.service``);
``None`` is Custom, any other URL. The catalog gives each service's label, group,
default base URL and whether it needs an API key. Base URLs were checked against
each service's own documentation on the date in ``CATALOG_CHECKED``; an
administrator can still change the URL after choosing a service.

The service changes nothing about how requests are sent: every entry here is
called through the same Chat Completions client as any OpenAI-compatible
endpoint. It is a record of where the provider came from, and the place later
per-service behavior would key on.
"""

from dataclasses import dataclass
from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic_core import PydanticCustomError

from .provider_types import ProviderType

CATALOG_CHECKED = date(2026, 11, 28)

ServiceGroup = Literal["hosted", "aggregator", "local"]


class ProviderService(StrEnum):
    """The known OpenAI-compatible services. Stored as text, so adding one needs no migration."""

    GEMINI = "gemini"
    MISTRAL = "mistral"
    XAI = "xai"
    DEEPSEEK = "deepseek"
    ANTHROPIC = "anthropic"
    OPENROUTER = "openrouter"
    GROQ = "groq"
    TOGETHER = "together"
    FIREWORKS = "fireworks"
    DEEPINFRA = "deepinfra"
    CEREBRAS = "cerebras"
    OLLAMA = "ollama"
    LM_STUDIO = "lm_studio"
    LLAMA_CPP = "llama_cpp"
    VLLM = "vllm"
    LOCALAI = "localai"
    JAN = "jan"


@dataclass(frozen=True)
class ServiceEntry:
    service: ProviderService
    label: str
    group: ServiceGroup
    base_url: str
    # Hosted services and aggregators need a key; local servers usually don't.
    key_required: bool
    docs_url: str


def _entry(service: ProviderService, label: str, group: ServiceGroup, base_url: str, docs_url: str) -> ServiceEntry:
    return ServiceEntry(service, label, group, base_url, key_required=group != "local", docs_url=docs_url)


S = ProviderService
CATALOG: tuple[ServiceEntry, ...] = (
    _entry(
        S.GEMINI,
        "Google Gemini",
        "hosted",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "https://aistudio.google.com/docs/openai",
    ),
    _entry(
        S.MISTRAL,
        "Mistral",
        "hosted",
        "https://api.mistral.ai/openai/v1",
        "https://docs.mistral.ai/inference/conversations/chat-completion",
    ),
    _entry(
        S.XAI,
        "xAI",
        "hosted",
        "https://api.x.ai/v1",
        "https://docs.x.ai/developers/rest-api-reference/inference/chat-completions",
    ),
    _entry(S.DEEPSEEK, "DeepSeek", "hosted", "https://api.deepseek.com", "https://api-docs.deepseek.com/"),
    _entry(
        S.ANTHROPIC,
        "Anthropic",
        "hosted",
        "https://api.anthropic.com/v1",
        "https://platform.claude.com/docs/en/api/openai-sdk",
    ),
    _entry(
        S.OPENROUTER,
        "OpenRouter",
        "aggregator",
        "https://openrouter.ai/api/v1",
        "https://openrouter.ai/docs/quickstart",
    ),
    _entry(S.GROQ, "Groq", "aggregator", "https://api.groq.com/openai/v1", "https://console.groq.com/docs/openai"),
    _entry(
        S.TOGETHER,
        "Together AI",
        "aggregator",
        "https://api.together.ai/v1",
        "https://docs.together.ai/docs/openai-api-compatibility",
    ),
    _entry(
        S.FIREWORKS,
        "Fireworks AI",
        "aggregator",
        "https://api.fireworks.ai/inference/v1",
        "https://docs.fireworks.ai/tools-sdks/openai-compatibility",
    ),
    _entry(
        S.DEEPINFRA,
        "DeepInfra",
        "aggregator",
        "https://api.deepinfra.com/v1/openai",
        "https://docs.deepinfra.com/chat/overview",
    ),
    _entry(
        S.CEREBRAS,
        "Cerebras",
        "aggregator",
        "https://api.cerebras.ai/v1",
        "https://inference-docs.cerebras.ai/resources/openai",
    ),
    _entry(
        S.OLLAMA, "Ollama", "local", "http://localhost:11434/v1", "https://docs.ollama.com/api/openai-compatibility"
    ),
    _entry(
        S.LM_STUDIO,
        "LM Studio",
        "local",
        "http://localhost:1234/v1",
        "https://lmstudio.ai/docs/developer/openai-compat",
    ),
    _entry(
        S.LLAMA_CPP,
        "llama.cpp server",
        "local",
        "http://localhost:9931/v1",
        "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md",
    ),
    _entry(
        S.VLLM,
        "vLLM",
        "local",
        "http://localhost:8000/v1",
        "https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/",
    ),
    _entry(S.LOCALAI, "LocalAI", "local", "http://localhost:8080/v1", "https://github.com/mudler/LocalAI"),
    _entry(S.JAN, "Jan", "local", "http://127.0.0.1:1337/v1", "https://docs.jan.ai/desktop/api-server"),
)
CATALOG_BY_SERVICE = {entry.service: entry for entry in CATALOG}


def check_service(provider_type: ProviderType, service: ProviderService | None) -> None:
    """Only an OpenAI-compatible provider records a service; OpenAI and ChatGPT plans have none."""
    if service is not None and provider_type != ProviderType.GENERIC_OPENAI:
        raise PydanticCustomError(
            "provider_service",
            "Only an OpenAI-compatible provider can name a service",
        )


def needs_key(provider_type: ProviderType, service: ProviderService | None) -> bool:
    """OpenAI, hosted services and aggregators need an API key; local servers and Custom don't (US-125.3)."""
    if provider_type == ProviderType.OPENAI:
        return True
    if provider_type != ProviderType.GENERIC_OPENAI or service is None:
        return False
    return CATALOG_BY_SERVICE[service].key_required


def key_missing_message(provider_type: ProviderType, service: ProviderService | None) -> str:
    """The refusal for a provider saved without the key it needs."""
    if provider_type == ProviderType.GENERIC_OPENAI and service is not None:
        return f"{CATALOG_BY_SERVICE[service].label} needs an API key"
    return "OpenAI needs an API key"
