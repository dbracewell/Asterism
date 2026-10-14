"""Chat-owned source cleanup boundary consumed by physical file deletion."""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from .draft_models import ChatDraftFileModel
from .models import ChatFileModel


async def detach_deleted_file(*, file_id: uuid.UUID, session: AsyncSession) -> None:
    # Keep message snapshots with stable IDs for historical missing-source display.
    await session.execute(delete(ChatDraftFileModel).where(ChatDraftFileModel.file_id == file_id))
    await session.execute(delete(ChatFileModel).where(ChatFileModel.file_id == file_id))
