"""Build the LLM client a provider's request capabilities call for."""

from __future__ import annotations

from asterism.domains.settings.schemas import ProviderInfo

from .capabilities import LLMApi, request_capabilities
from .client import LLMClient
from .responses import ResponsesLLMClient
from .schemas import LLMClientProtocol


def create_llm_client(model_name: str, provider: ProviderInfo) -> LLMClientProtocol:
    """Return a client for ``model_name`` that speaks the provider's wire API."""
    capabilities = request_capabilities(provider.provider_type)
    match capabilities.api:
        case LLMApi.CHAT_COMPLETIONS:
            client_type = LLMClient
        case LLMApi.RESPONSES:
            client_type = ResponsesLLMClient
    return client_type(
        model_name=model_name,
        api_key=provider.api_key,
        base_url=provider.base_url,
        capabilities=capabilities,
    )
