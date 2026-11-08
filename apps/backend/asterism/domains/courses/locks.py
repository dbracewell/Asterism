"""Course-managed records are read-only to the student (US-67.1, ADR-0054).

A record is course-managed while it is the project of a student's course copy,
or a sub-agent or file that a course item became, and the student is still a
current member of the class. The lock is read live on every guarded write:
deleting the project, leaving the class or deleting the class releases it.
Only the course update path (``copies.apply_course``) changes locked records.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CourseManagedException
from asterism.domains.classes.models import ClassMemberModel, ClassModel

from .models import CourseCopyItemModel, CourseCopyModel


async def managing_class(user_id: str, record_ids: Iterable[uuid.UUID], session: AsyncSession) -> str | None:
    """The name of the class whose live course copy manages any of the records, if one does."""
    ids = list(dict.fromkeys(record_ids))
    if not ids:
        return None
    managed_item = exists().where(
        CourseCopyItemModel.class_id == CourseCopyModel.class_id,
        CourseCopyItemModel.user_id == CourseCopyModel.user_id,
        CourseCopyItemModel.record_id.in_(ids),
    )
    return await session.scalar(
        select(ClassModel.name)
        .join(CourseCopyModel, CourseCopyModel.class_id == ClassModel.id)
        .join(
            ClassMemberModel,
            (ClassMemberModel.class_id == ClassModel.id) & (ClassMemberModel.user_id == CourseCopyModel.user_id),
        )
        .where(
            CourseCopyModel.user_id == user_id,
            CourseCopyModel.project_id.is_not(None),
            ClassMemberModel.removed_at.is_(None),
            or_(CourseCopyModel.project_id.in_(ids), managed_item),
        )
        .order_by(ClassModel.name)
        .limit(1)
    )


async def managed_records(user_id: str, record_ids: Iterable[uuid.UUID], session: AsyncSession) -> dict[uuid.UUID, str]:
    """Map each course-managed record among ``record_ids`` to its class name; others are absent.

    Read models use this to show the lock (US-67.2); the writes still check it themselves.
    """
    ids = list(dict.fromkeys(record_ids))
    if not ids:
        return {}
    live = (
        select(CourseCopyModel.class_id, CourseCopyModel.user_id, CourseCopyModel.project_id, ClassModel.name)
        .join(ClassModel, ClassModel.id == CourseCopyModel.class_id)
        .join(
            ClassMemberModel,
            (ClassMemberModel.class_id == ClassModel.id) & (ClassMemberModel.user_id == CourseCopyModel.user_id),
        )
        .where(
            CourseCopyModel.user_id == user_id,
            CourseCopyModel.project_id.is_not(None),
            ClassMemberModel.removed_at.is_(None),
        )
        .subquery()
    )
    projects = await session.execute(select(live.c.project_id, live.c.name).where(live.c.project_id.in_(ids)))
    items = await session.execute(
        select(CourseCopyItemModel.record_id, live.c.name)
        .join(
            live,
            (CourseCopyItemModel.class_id == live.c.class_id) & (CourseCopyItemModel.user_id == live.c.user_id),
        )
        .where(CourseCopyItemModel.record_id.in_(ids))
    )
    managed: dict[uuid.UUID, str] = {}
    for record_id, name in sorted([*projects.all(), *items.all()], key=lambda row: row[1], reverse=True):
        if record_id is not None:
            managed[record_id] = name
    return managed


async def require_not_course_managed(*, user_id: str, record_ids: Iterable[uuid.UUID], session: AsyncSession) -> None:
    """Refuse a student's own change to a course-managed project, sub-agent or file.

    Raises:
        CourseManagedException: 409 with reason ``course_managed``.
    """
    class_name = await managing_class(user_id, record_ids, session)
    if class_name is not None:
        raise CourseManagedException(
            f"This is part of the course for {class_name}, so only course updates can change it. "
            "Delete the course project to leave the course."
        )
