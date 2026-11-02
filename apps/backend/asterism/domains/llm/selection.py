"""A model the caller chose for a one-off internal pass (study tools, verification)."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException
from asterism.domains.chatgpt.availability import ModelAvailability
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import select_visible_models
from asterism.domains.settings.schemas import LlmWithProvider

from .factory import create_llm_client
from .schemas import LLMClientProtocol, LLMMessage

ModelCall = Callable[[list[LLMMessage]], Awaitable[str]]
"""Messages in, reply text out."""


@dataclass(frozen=True)
class ModelReply:
    """Reply text and provider-reported usage of one call (0 when not reported)."""

    content: str
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class SelectedModel:
    """A resolved model: its id and name for provenance, and its client."""

    id: uuid.UUID
    name: str
    client: LLMClientProtocol

    async def reply(self, messages: list[LLMMessage]) -> ModelReply:
        event = await self.client.generate(messages=messages)
        if event.exception:
            raise event.exception
        return ModelReply(
            content=event.content or "",
            input_tokens=getattr(event, "input_tokens", 0) or 0,
            output_tokens=getattr(event, "output_tokens", 0) or 0,
        )

    async def call(self, messages: list[LLMMessage]) -> str:
        return (await self.reply(messages)).content


async def resolve_usable_model(*, user_id: str, model_id: uuid.UUID, session: AsyncSession) -> SelectedModel:
    """A model the caller may use right now, or 409 with the reason."""
    row = await session.scalar(
        select_visible_models(user_id).where(LLMModel.id == model_id).execution_options(populate_existing=True)
    )
    reason = (await ModelAvailability.load(user_id, session)).reason(row) if row is not None else "not found"
    if row is None or reason is not None:
        raise CodedException(409, f"Selected model is unavailable ({reason}); choose another model")
    info = LlmWithProvider.model_validate(row)
    client = create_llm_client(info.name, info.provider, user_id=user_id)
    return SelectedModel(id=row.id, name=row.display_name or info.name, client=client)


async def visible_model_name(*, user_id: str, model_id: uuid.UUID, session: AsyncSession) -> str:
    """The name of a model the caller can see (availability is not required), or 400."""
    row = await session.scalar(select_visible_models(user_id).where(LLMModel.id == model_id))
    if row is None:
        raise BadDataException("Choose a model you can use")
    return row.display_name or row.name
