"""Build the LLM client a provider's request capabilities call for."""

from __future__ import annotations

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import ProviderInfo, RuntimeProviderInfo

from .capabilities import LLMApi, request_capabilities
from .client import LLMClient
from .errors import LLMProviderError
from .responses import AccessTokenSupplier, ResponsesLLMClient
from .schemas import LLMClientProtocol

# Placeholder pool key: plan requests replace it with the owner's access token.
_PLAN_POOL_KEY = "chatgpt-plan"


def _plan_access_token(owner_user_id: str) -> AccessTokenSupplier:
    async def supply() -> str:
        from asterism.domains.chatgpt.service import ChatGPTPlanUnavailable, access_token

        try:
            return (await access_token(owner_user_id)).access_token
        except ChatGPTPlanUnavailable as error:
            raise LLMProviderError(str(error), code=f"chatgpt_plan_{error.reason.value}") from error

    return supply


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
        return ResponsesLLMClient(
            model_name=model_name,
            api_key=_PLAN_POOL_KEY,
            base_url=provider.base_url,
            capabilities=capabilities,
            access_token=_plan_access_token(owner),
        )
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
