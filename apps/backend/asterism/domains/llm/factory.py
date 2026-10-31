"""Build the LLM client a provider's request capabilities call for."""

from __future__ import annotations

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import ProviderInfo, RuntimeProviderInfo

from .capabilities import LLMApi, request_capabilities
from .client import LLMClient
from .responses import ResponsesLLMClient
from .schemas import LLMClientProtocol


def create_llm_client(
    model_name: str,
    provider: ProviderInfo,
    *,
    user_id: str | None = None,
) -> LLMClientProtocol:
    """Return a client for ``model_name`` that speaks the provider's wire API.

    A ChatGPT plan provider runs only for its owner (``user_id``) and only on
    that owner's connection; any other caller is refused.
    """
    capabilities = request_capabilities(provider.provider_type)
    if provider.provider_type == ProviderType.CHATGPT:
        owner = provider.owner_user_id if isinstance(provider, RuntimeProviderInfo) else None
        if owner is None or owner != user_id:
            raise BadDataException("ChatGPT plan models run only for the user who connected them")
        from asterism.domains.chatgpt.plan_client import ChatGPTPlanClient

        return ChatGPTPlanClient(model_name=model_name, base_url=provider.base_url, owner_user_id=owner)
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
