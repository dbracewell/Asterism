"""Class mode policy in course projects (US-60.4, ADR-0055).

The policy belongs to the class and applies to a student's course project while
they are a current member. It only narrows: it can refuse a mode or a reveal,
never enable anything. ``chat.mode_policy`` combines it with the learner's own
lock and reads it live on every check (ADR-0068).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.agent.learning_inputs import LearningModeId
from asterism.domains.classes.models import ClassMemberModel, ClassModel
from asterism.domains.classes.names import educator_name

from .models import CourseCopyModel


@dataclass(frozen=True)
class ActivePolicy:
    class_name: str
    educator_name: str
    allowed_modes: frozenset[LearningModeId] | None
    answer_reveal: bool
    memory_enabled: bool = True
    study_chat_enabled: bool = True

    def allows(self, mode: LearningModeId | str) -> bool:
        return self.allowed_modes is None or LearningModeId(mode) in self.allowed_modes


async def course_mode_policy(
    *, user_id: str, project_id: uuid.UUID | None, session: AsyncSession
) -> ActivePolicy | None:
    """The policy for one of the user's projects, or None when nothing is limited."""
    if project_id is None:
        return None
    row = await session.scalar(
        select(ClassModel)
        .join(CourseCopyModel, CourseCopyModel.class_id == ClassModel.id)
        .join(
            ClassMemberModel,
            (ClassMemberModel.class_id == ClassModel.id) & (ClassMemberModel.user_id == CourseCopyModel.user_id),
        )
        .where(
            CourseCopyModel.user_id == user_id,
            CourseCopyModel.project_id == project_id,
            ClassMemberModel.removed_at.is_(None),
        )
        .execution_options(populate_existing=True)
    )
    if row is None or (
        row.allowed_modes is None and row.answer_reveal and row.memory_enabled and row.study_chat_enabled
    ):
        return None
    allowed = None
    if row.allowed_modes is not None:
        # Ignore a stored mode the catalog no longer offers, so retiring one can't widen anything.
        allowed = frozenset(LearningModeId(mode) for mode in row.allowed_modes if mode in LearningModeId)
    return ActivePolicy(
        class_name=row.name,
        educator_name=await educator_name(row.educator_id, session),
        allowed_modes=allowed,
        answer_reveal=row.answer_reveal,
        memory_enabled=row.memory_enabled,
        study_chat_enabled=row.study_chat_enabled,
    )
