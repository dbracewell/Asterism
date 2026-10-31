"""Explicit chat model selection; owner checks and guarded revision changes."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.chatgpt.availability import ModelAvailability
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import select_visible_models

from .jobs import chat_jobs
from .models import ChatModel
from .queries import select_owned_chats
from .schemas import ChatInfo, ChatModelChoice, ChatModelUpdate


def model_choice(model: LLMModel, availability: ModelAvailability) -> ChatModelChoice:
    reason = availability.reason(model)
    return ChatModelChoice(
        id=model.id,
        name=model.name,
        display_name=model.display_name,
        provider_id=model.provider_id,
        provider_name=model.provider.name,
        provider_type=model.provider.provider_type,
        available=reason is None,
        enabled=model.is_active,
        authorized=True,
        unavailable_reason=reason,
        unavailable_code=availability.code(model),
        context_window=model.context_window,
        context_window_source=model.context_window_source,
        supports_vision=model.supports_vision,
        supports_tools=model.supports_tools,
    )


async def list_chat_models(user_id: str, session: AsyncSession) -> list[ChatModelChoice]:
    """Global provider models plus the caller's own ChatGPT plan models."""
    availability = await ModelAvailability.load(user_id, session)
    rows = await session.scalars(select_visible_models(user_id).order_by(LLMModel.name, LLMModel.id))
    return [model_choice(row, availability) for row in rows]


async def require_chat_model(model_id: uuid.UUID, user_id: str, session: AsyncSession) -> ChatModelChoice:
    row = await session.scalar(
        select_visible_models(user_id).where(LLMModel.id == model_id).execution_options(populate_existing=True),
    )
    choice = model_choice(row, await ModelAvailability.load(user_id, session)) if row is not None else None
    if choice is None or not choice.available:
        reason = choice.unavailable_reason if choice is not None else None
        raise CodedException(
            409,
            f"Selected model is unavailable ({reason}); choose an available chat model and regenerate or retry"
            if reason
            else "Selected model is unavailable; choose an available chat model and regenerate or retry",
        )
    return choice


async def selected_chat_model(chat: ChatModel, session: AsyncSession) -> ChatModelChoice | None:
    if chat.selected_model_id is None:
        return None
    row = await session.scalar(
        select_visible_models(chat.user_id)
        .where(LLMModel.id == chat.selected_model_id)
        .execution_options(populate_existing=True),
    )
    if row is not None:
        return model_choice(row, await ModelAvailability.load(chat.user_id, session))
    saved = chat.selected_model_snapshot
    if saved is None:
        return None
    return saved.model_copy(
        update={
            "available": False,
            "enabled": False,
            "authorized": False,
            "unavailable_reason": "Selected model was removed; choose another model",
        },
    )


async def selection_info(chat: ChatModel, session: AsyncSession) -> ChatInfo:
    from .skills import branch_skills, describe_skills

    info = ChatInfo.model_validate(chat)
    info.active_skills = await describe_skills(
        chat.user_id, await branch_skills(chat.user_id, chat.id, session), session
    )
    info.selected_model = await selected_chat_model(chat, session)
    return info


async def change_chat_model(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatModelUpdate,
    session: AsyncSession | None = None,
) -> ChatInfo:
    async with get_async_db_session(session) as session:
        owned = await session.scalar(
            select_owned_chats(user_id=user_id).with_only_columns(ChatModel.id).where(ChatModel.id == chat_id),
        )
        if owned is None:
            raise NotFoundException("Chat not found")
        with chat_jobs.guard_idle_change(chat_id):
            try:
                chat = await session.scalar(
                    update(ChatModel)
                    .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
                    .values(updated_at=ChatModel.updated_at)
                    .returning(ChatModel)
                    .execution_options(populate_existing=True),
                )
                if chat is None:
                    raise NotFoundException("Chat not found")
                if chat.model_revision != payload.expected_model_revision:
                    raise CodedException(409, "Chat model selection changed; reload and retry")
                choice = await require_chat_model(payload.model_id, user_id, session)
                if chat.selected_model_id != payload.model_id:
                    chat.selected_model_id = payload.model_id
                    chat.model_revision += 1
                chat.selected_model_snapshot = choice
                await session.flush()
                response = await selection_info(chat, session)
                await session.commit()
                return response
            except BaseException:
                await session.rollback()
                raise
