"""Reflection lifecycle and partitioned reads (US-58.2, ADR-0048)."""

import uuid

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.personas import read_chat_persona_snapshot
from asterism.domains.chat.queries import select_owned_chats
from asterism.domains.user.personas import require_owned_persona

from .models import ReflectionModel
from .queries import select_owned_reflections, select_scoped_reflections
from .schemas import Reflection, ReflectionCreate, ReflectionPage, ReflectionUpdate

logger = get_logger("Reflections")


async def require_owned_chat(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> ChatModel:
    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        raise NotFoundException("Chat not found")
    return chat


async def _require(user_id: str, reflection_id: uuid.UUID, session: AsyncSession) -> ReflectionModel:
    row = await session.scalar(select_owned_reflections(user_id).where(ReflectionModel.id == reflection_id))
    if row is None:
        raise NotFoundException("Reflection not found")
    return row


async def create_reflection(user_id: str, payload: ReflectionCreate, session: AsyncSession) -> Reflection:
    """Record a reflection under the chat's project and its current persona."""
    chat = await require_owned_chat(user_id, payload.chat_id, session)
    persona = await read_chat_persona_snapshot(user_id=user_id, chat_id=chat.id, session=session)
    row = ReflectionModel(
        user_id=user_id,
        persona_id=persona.id,
        project_id=chat.project_id,
        chat_id=chat.id,
        learned=payload.learned.strip(),
        unclear=payload.unclear.strip(),
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    logger.info(f"Created reflection {row.id} for user {user_id}")
    return Reflection.model_validate(row)


async def list_reflections(
    user_id: str,
    session: AsyncSession,
    *,
    project_id: uuid.UUID | None,
    persona_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> ReflectionPage:
    if persona_id is not None:
        # A foreign persona must not reveal whether it exists.
        await require_owned_persona(user_id=user_id, persona_id=persona_id, session=session)
    result = await paginate_select(
        statement=select_scoped_reflections(user_id, project_id=project_id, persona_id=persona_id),
        session=session,
        page=page,
        page_size=page_size,
    )
    return ReflectionPage(
        items=[Reflection.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def update_reflection(
    user_id: str, reflection_id: uuid.UUID, payload: ReflectionUpdate, session: AsyncSession
) -> Reflection:
    await _require(user_id, reflection_id, session)
    result = await session.execute(
        update(ReflectionModel)
        .where(
            ReflectionModel.id == reflection_id,
            ReflectionModel.user_id == user_id,
            ReflectionModel.revision == payload.expected_revision,
        )
        .values(
            learned=payload.learned.strip(),
            unclear=payload.unclear.strip(),
            revision=ReflectionModel.revision + 1,
        )
        .returning(ReflectionModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Reflection changed; reload before saving")
    await session.commit()
    row = await _require(user_id, reflection_id, session)
    await session.refresh(row)
    return Reflection.model_validate(row)


async def delete_reflection(
    user_id: str, reflection_id: uuid.UUID, expected_revision: int, session: AsyncSession
) -> None:
    await _require(user_id, reflection_id, session)
    result = await session.execute(
        delete(ReflectionModel)
        .where(
            ReflectionModel.id == reflection_id,
            ReflectionModel.user_id == user_id,
            ReflectionModel.revision == expected_revision,
        )
        .returning(ReflectionModel.id)
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Reflection changed; reload before deleting")
    await session.commit()
    logger.info(f"Deleted reflection {reflection_id} for user {user_id}")
