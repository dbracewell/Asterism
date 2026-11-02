"""Chat-owned file membership boundaries consumed by the files domain."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException

from .draft_models import ChatDraftFileModel
from .execution_models import ChatExecutionModel
from .models import ChatFileModel


async def detach_deleted_file(*, file_id: uuid.UUID, session: AsyncSession) -> None:
    # Keep message snapshots with stable IDs for historical missing-source display.
    await session.execute(delete(ChatDraftFileModel).where(ChatDraftFileModel.file_id == file_id))
    await session.execute(delete(ChatFileModel).where(ChatFileModel.file_id == file_id))


async def attach_produced_file(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    execution_id: uuid.UUID,
    file_id: uuid.UUID,
    session: AsyncSession,
) -> None:
    """Make a produced file a member of the chat that ran its producing run.

    Membership alone grants nothing: branch scope admits the file only while a
    message of ``execution_id`` is on the active branch (see ``scope``).
    """
    run = await session.scalar(
        select(ChatExecutionModel.id).where(
            ChatExecutionModel.id == execution_id,
            ChatExecutionModel.chat_id == chat_id,
            ChatExecutionModel.user_id == user_id,
        )
    )
    if run is None:
        raise BadDataException("The producing run does not belong to this chat")
    session.add(ChatFileModel(chat_id=chat_id, file_id=file_id, user_id=user_id))
    await session.flush()
