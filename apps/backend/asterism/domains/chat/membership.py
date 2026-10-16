"""Chat-owned project membership mutations and transaction-local detachment."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.projects.scope import require_owned_project

from .jobs import chat_jobs
from .models import ChatModel
from .schemas import ChatInfo, ChatMoveRequest


async def move_chat(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatMoveRequest,
    session: AsyncSession | None = None,
) -> ChatInfo:
    async with get_async_db_session(session) as session:
        # Resolve ownership before runtime state to avoid leaking a foreign chat's activity.
        owned = await session.scalar(
            select(ChatModel.id).where(
                ChatModel.id == chat_id,
                ChatModel.user_id == user_id,
            ),
        )
        if owned is None:
            raise NotFoundException("Chat not found")
        with chat_jobs.guard_idle_change(chat_id):
            try:
                chat = await session.scalar(
                    update(ChatModel)
                    .where(
                        ChatModel.id == chat_id,
                        ChatModel.user_id == user_id,
                    )
                    .values(updated_at=ChatModel.updated_at)
                    .returning(ChatModel)
                    .execution_options(populate_existing=True),
                )
                if chat is None:
                    raise NotFoundException("Chat not found")
                if payload.project_id is not None:
                    await require_owned_project(user_id=user_id, project_id=payload.project_id, session=session)
                if chat.project_id != payload.project_id:
                    chat.project_id = payload.project_id
                await session.flush()
                response = ChatInfo.model_validate(chat)
                await session.commit()
                return response
            except IntegrityError as error:
                await session.rollback()
                raise CodedException(409, "Chat or project changed; reload and retry") from error
            except Exception:
                await session.rollback()
                raise


async def retire_project_chat_runs(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> None:
    """Cancel active runtime jobs for an owned project's chats; persistence is untouched."""
    chat_ids = list(
        await session.scalars(
            select(ChatModel.id).where(ChatModel.user_id == user_id, ChatModel.project_id == project_id),
        ),
    )
    for chat_id in chat_ids:
        await chat_jobs.retire(chat_id)


async def detach_project_chats(*, user_id: str, project_id: uuid.UUID, session: AsyncSession) -> None:
    """Caller owns commit/rollback; history and local attachments remain untouched."""
    await session.execute(
        update(ChatModel)
        .where(
            ChatModel.user_id == user_id,
            ChatModel.project_id == project_id,
        )
        .values(project_id=None)
        .execution_options(synchronize_session="fetch"),
    )
