# pip install transformers
from typing import Unpack

import asterism.domains.settings.service as settings_service
from asterism.common.concurrency import Atomic
from asterism.core.events import Event, EventType, event_bus

from .client import LLMClient
from .schemas import ChatCompletionParams, LLMClientProtocol, LLMMessage


class NoModelDefinedException(Exception):
    def __init__(self, message: str = "No draft model defined."):
        super().__init__(message)


class DraftModel:
    def __init__(self):
        self._llm_client: LLMClientProtocol | None = None

    async def get_model(self) -> LLMClientProtocol:
        if self._llm_client is not None:
            return self._llm_client

        draft_model = await settings_service.get_draft_model()
        client = LLMClient(
            api_key=draft_model.provider.api_key,
            base_url=draft_model.provider.base_url,
            model_name=draft_model.name,
        )
        self._llm_client = client
        return client

    async def invoke(
        self,
        messages: list[LLMMessage],
        **kwargs: Unpack[ChatCompletionParams],
    ) -> str:
        llm = await self.get_model()
        event = await llm.generate(
            messages=messages,
            **kwargs,
        )
        # A normal completion can legitimately have no visible text (for
        # example, if a provider spends its generation budget on reasoning).
        # Do not stringify its absent exception as the literal title "None".
        if event.exception:
            raise event.exception

        if event.content:
            return event.content

        return ""


_draft_model: Atomic[DraftModel | None] = Atomic(None)


def get_draft_model() -> DraftModel:
    global _draft_model
    with _draft_model as (get, set):
        model = get()
        if model is not None:
            return model

        new_model = DraftModel()
        set(new_model)
        return new_model


@event_bus.on(EventType.DRAFT_MODEL_UPDATED)
async def _on_model_update(_: Event) -> None:
    global _draft_model
    _draft_model.value = None
