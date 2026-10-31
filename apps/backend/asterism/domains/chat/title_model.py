"""Which model writes a chat's title: the draft model, else the owner's plan.

The admin-configured draft model is always preferred. Only when no draft model
is usable (unset, inactive or removed) does titling run on the chat owner's own
ChatGPT plan: the chat's selected model when it is one of the owner's
available plan models, otherwise the owner's first available plan model. It
never uses another user's plan, and plan availability (policy, connection,
usage pause) is the same rule chats use. ``None`` means no model can title the
chat, and the caller keeps its text fallback.
"""

from __future__ import annotations

import uuid
from typing import Protocol

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.chatgpt.availability import ModelAvailability
from asterism.domains.llm.draft import get_draft_model
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.schemas import LLMClientProtocol, LLMMessage
from asterism.domains.settings.models import LLMModel, ProviderModel
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.queries import select_visible_models
from asterism.domains.settings.schemas import LlmWithProvider

logger = get_logger("ChatTitleModel")


class TitleModel(Protocol):
    async def invoke(self, messages: list[LLMMessage]) -> str: ...


class PlanTitleModel:
    """Titles on one user's plan model; mirrors ``DraftModel.invoke``."""

    def __init__(self, client: LLMClientProtocol) -> None:
        self._client = client

    async def invoke(self, messages: list[LLMMessage]) -> str:
        event = await self._client.generate(messages=messages)
        if event.exception:
            raise event.exception
        return event.content or ""


async def plan_title_model(user_id: str, selected_model_id: uuid.UUID | None) -> PlanTitleModel | None:
    """The owner's available plan model for titling, or ``None``."""
    async with get_async_db_session() as session:
        availability = await ModelAvailability.load(user_id, session)
        if availability.plan is not None:
            return None
        rows = await session.scalars(
            select_visible_models(user_id)
            .where(
                ProviderModel.owner_user_id == user_id,
                ProviderModel.provider_type == ProviderType.CHATGPT,
                LLMModel.is_active,
            )
            .order_by(LLMModel.name, LLMModel.id),
        )
        models = [model for model in rows if availability.reason(model) is None]
        chosen = next((model for model in models if model.id == selected_model_id), models[0] if models else None)
        if chosen is None:
            return None
        info = LlmWithProvider.model_validate(chosen)
    logger.info("Titling on the owner's ChatGPT plan user=%s model=%s", user_id, info.name)
    return PlanTitleModel(create_llm_client(info.name, info.provider, user_id=user_id))


async def resolve_title_model(user_id: str, selected_model_id: uuid.UUID | None) -> TitleModel | None:
    """The draft model when usable, else the owner's plan model, else ``None``.

    A configured draft model that fails at generation time does not switch to
    the plan; only an unset or unavailable draft model does.
    """
    draft = get_draft_model()
    try:
        await draft.get_model()
        return draft
    except (NotFoundException, BadDataException) as error:
        logger.info("No usable draft model for titles (%s); trying the owner's plan", error)
    return await plan_title_model(user_id, selected_model_id)
