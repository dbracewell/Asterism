"""The caller's chosen model for study generation and grading."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException
from asterism.domains.chatgpt.availability import ModelAvailability
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.schemas import LLMClientProtocol, LLMMessage
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import select_visible_models
from asterism.domains.settings.schemas import LlmWithProvider

ModelCall = Callable[[list[LLMMessage]], Awaitable[str]]


@dataclass(frozen=True)
class StudyModel:
    """A resolved model: its id and name for provenance, and a call that returns reply text."""

    id: uuid.UUID
    name: str
    call: ModelCall


async def resolve_model(*, user_id: str, model_id: uuid.UUID, session: AsyncSession) -> StudyModel:
    """A model the caller may use right now, or 409 with the reason."""
    row = await session.scalar(
        select_visible_models(user_id).where(LLMModel.id == model_id).execution_options(populate_existing=True)
    )
    reason = (await ModelAvailability.load(user_id, session)).reason(row) if row is not None else "not found"
    if row is None or reason is not None:
        raise CodedException(409, f"Selected model is unavailable ({reason}); choose another model")
    info = LlmWithProvider.model_validate(row)
    client: LLMClientProtocol = create_llm_client(info.name, info.provider, user_id=user_id)

    async def call(messages: list[LLMMessage]) -> str:
        event = await client.generate(messages=messages)
        if event.exception:
            raise event.exception
        return event.content or ""

    return StudyModel(id=row.id, name=row.display_name or info.name, call=call)


async def visible_model_name(*, user_id: str, model_id: uuid.UUID, session: AsyncSession) -> str:
    """The name of a model the caller can see (availability is not required), or 400."""
    row = await session.scalar(select_visible_models(user_id).where(LLMModel.id == model_id))
    if row is None:
        raise BadDataException("Choose a model you can use")
    return row.display_name or row.name
