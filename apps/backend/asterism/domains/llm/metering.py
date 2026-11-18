"""Record each completed call of an LLM client in the usage ledger (ADR-0073).

The wrapper passes every event through unchanged and, on the one terminal
event, records the provider-reported tokens. A stream the caller abandons
before its terminal event (for example a cancelled run) reports no usage and
records nothing.
"""

import uuid
from collections.abc import AsyncGenerator
from dataclasses import replace
from typing import Any, Type, Unpack

from pydantic import BaseModel

from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import LlmWithProvider
from asterism.domains.usage.schemas import UsageMeter, UsageSource
from asterism.domains.usage.service import record_usage

from .schemas import ChatCompletionParams, LLMClientProtocol, LLMEvent, LLMEventType, LLMMessage

_TERMINAL = {LLMEventType.COMPLETE, LLMEventType.ERROR}


class MeteredLLMClient(LLMClientProtocol):
    """An LLM client that charges each completed call to ``meter``."""

    def __init__(self, inner: LLMClientProtocol, meter: UsageMeter) -> None:
        self._inner = inner
        self.meter = meter

    async def _record(self, event: LLMEvent[Any]) -> None:
        await record_usage(self.meter, input_tokens=event.input_tokens, output_tokens=event.output_tokens)

    async def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[BaseModel] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[BaseModel], None]:
        async for event in self._inner.chat(messages, tools, response_model, **kwargs):
            if event.type in _TERMINAL:
                await self._record(event)
            yield event

    async def generate[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> LLMEvent[T]:
        event = await self._inner.generate(messages, tools, response_model, **kwargs)
        await self._record(event)
        return event

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def metered(client: LLMClientProtocol, meter: UsageMeter | None) -> LLMClientProtocol:
    """Wrap ``client`` so its calls are charged to ``meter``; ``None`` leaves it unmetered."""
    return client if meter is None else MeteredLLMClient(client, meter)


def meter_for(
    user_id: str,
    source: UsageSource,
    model: LlmWithProvider,
    *,
    chat_id: uuid.UUID | None = None,
) -> UsageMeter:
    """Charge calls on ``model`` to ``user_id``, with the model's current price (none on a ChatGPT plan)."""
    plan = model.provider.provider_type == ProviderType.CHATGPT
    return UsageMeter(
        user_id=user_id,
        source=source,
        model_id=model.id,
        model_name=model.name,
        pricing=None if plan else model.pricing,
        plan=plan,
        chat_id=chat_id,
    )


def with_source(client: LLMClientProtocol, source: UsageSource) -> LLMClientProtocol:
    """The same client charged to the same user and model, under another source; unmetered stays unmetered."""
    if isinstance(client, MeteredLLMClient):
        return MeteredLLMClient(client._inner, replace(client.meter, source=source))
    return client
