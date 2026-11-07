"""Course file bytes, kept in the educator's file-store shard."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.domains.files.service import get_file_store

from .models import CourseFileModel, CourseVersionModel

logger = get_logger("CourseStorage")


async def course_storage_keys(class_id: uuid.UUID, session: AsyncSession) -> list[str]:
    """Stored course bytes, to remove once the class's deletion commits."""
    keys = await session.scalars(
        select(CourseFileModel.storage_key)
        .join(CourseVersionModel, CourseVersionModel.id == CourseFileModel.version_id)
        .where(CourseVersionModel.class_id == class_id, CourseFileModel.storage_key.is_not(None))
    )
    return [key for key in keys if key]


def remove_course_bytes(educator_id: str, keys: list[str]) -> None:
    """Best effort: a leftover file wastes space but is never reachable."""
    store = get_file_store()
    for key in keys:
        try:
            store.delete(educator_id, key)
        except Exception:
            logger.warning("Could not remove a course file", extra={"storage_key": key})
