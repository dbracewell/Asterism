"""Build the LLM client a provider's request capabilities call for."""

from __future__ import annotations

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import ProviderInfo, RuntimeProviderInfo
from asterism.domains.usage.schemas import UsageMeter

from .capabilities import LLMApi, request_capabilities
from .client import LLMClient
from .metering import metered
from .responses import ResponsesLLMClient
from .schemas import LLMClientProtocol


def create_llm_client(
    model_name: str,
    provider: ProviderInfo,
    *,
    user_id: str | None = None,
    usage: UsageMeter | None,
) -> LLMClientProtocol:
    """Return a client for ``model_name`` that speaks the provider's wire API.

    A ChatGPT plan provider runs only for its owner (``user_id``) and only on
    that owner's connection; any other caller is refused. Every caller says who
    pays: ``usage`` charges each completed call to a user (ADR-0073), and
    ``None`` is only for a client wrapped later, per call (see ``draft.py``).
    """
    return metered(_create(model_name, provider, user_id=user_id), usage)


def _create(model_name: str, provider: ProviderInfo, *, user_id: str | None) -> LLMClientProtocol:
    capabilities = request_capabilities(provider.provider_type, provider.service)
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
