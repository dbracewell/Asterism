# pip install transformers
from typing import Unpack

from pydantic import BaseModel

from asterism.common import Atomic, ChatCompletionParams, LLMMessage
from asterism.common.atomic import AsyncAtomic
from asterism.events import Event, EventType, event_bus

from .client import LLMClient


class NoModelDefinedException(Exception):
    def __init__(self, message: str = "No draft model defined."):
        super().__init__(message)


class DraftModel:
    def __init__(self):
        self.llm: AsyncAtomic[LLMClient | None] = AsyncAtomic(None)

    async def get_model(self) -> LLMClient:
        from asterism.repositories import settings_repository

        async with self.llm as (get, set):
            client = get()
            if client:
                return client

            draft_model = await settings_repository.get_draft_model()
            client = LLMClient(
                api_key=draft_model.provider.api_key,
                base_url=draft_model.provider.base_url,
                model_name=draft_model.name,
            )
            set(client)

            return client

    async def invoke[T: BaseModel](
        self,
        messages: list[LLMMessage],
        **kwargs: Unpack[ChatCompletionParams],
    ) -> str:
        llm = await self.get_model()
        event = await llm.chat_to_completion(
            messages=messages,
            **kwargs,
        )
        return event.content or ""

    async def label_chat(self, user_prompt: str) -> str:
        content = await self.invoke(
            messages=[
                LLMMessage.user(
                    content=f"""You are a title generation assistant. Generate a short, descriptive chat title (3 to 6 words) based on the user's text. Output strictly the title itself with no quotes, no prefixes, and no trailing punctuation. Do not repeat the user's text and do not answer the user's questions or requests. Only generate a generic title that labels the intent of the user.
                    
                    User Prompt: {user_prompt}""",  # noqa: E501
                ),
            ],
            max_tokens=100,
            temperature=0.3,
            top_p=0.9,
            thinking_budget_tokens=30,
        )
        return content.strip()


_draft_model: Atomic[DraftModel | None] = Atomic(None)


def get_draft_model() -> DraftModel:
    global _draft_model
    with _draft_model as (get, set):
        model = get()
        if model:
            return model

        new_model = DraftModel()
        set(new_model)
        return new_model


@event_bus.on(EventType.DRAFT_MODEL_UPDATED)
async def _on_model_update(_: Event) -> None:
    global _draft_model
    _draft_model.value = None
