"""Class mode policy in course projects (US-60.4, ADR-0055).

The policy belongs to the class and applies to a student's course project while
they are a current member. It only narrows: it can refuse a mode or a reveal,
never enable anything. Every send, mode change and execution reads it live.
"""

import uuid
from dataclasses import dataclass

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId
from asterism.domains.classes.models import ClassMemberModel, ClassModel
from asterism.domains.learning.catalog import LEARNING_MODES

from .models import CourseCopyModel


class CourseModePolicy(BaseModel):
    """What a student sees: the limits in force and who set them."""

    class_name: str
    educator_name: str
    allowed_modes: list[LearningModeId] | None = Field(description="null allows every mode")
    answer_reveal: bool


@dataclass(frozen=True)
class ActivePolicy:
    class_name: str
    educator_name: str
    allowed_modes: frozenset[LearningModeId] | None
    answer_reveal: bool

    def _by(self) -> str:
        return f"{self.educator_name} set this for {self.class_name}"

    def allows(self, mode: LearningModeId | str) -> bool:
        return self.allowed_modes is None or LearningModeId(mode) in self.allowed_modes

    def require_mode(self, mode: LearningModeId | str) -> None:
        if not self.allows(mode):
            names = ", ".join(
                LEARNING_MODES[item].name
                for item in LearningModeId
                if self.allowed_modes and item in self.allowed_modes
            )
            raise ConflictException(f"This course project allows only {names} mode. {self._by()}.")

    def require_level(self, level: HintLevel | None) -> None:
        if level == HintLevel.ANSWER and not self.answer_reveal:
            raise ConflictException(f"Showing answers is turned off in this course project. {self._by()}.")

    def view(self) -> CourseModePolicy:
        return CourseModePolicy(
            class_name=self.class_name,
            educator_name=self.educator_name,
            allowed_modes=[mode for mode in LearningModeId if mode in self.allowed_modes]
            if self.allowed_modes is not None
            else None,
            answer_reveal=self.answer_reveal,
        )


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
    if row is None or (row.allowed_modes is None and row.answer_reveal):
        return None
    allowed = None
    if row.allowed_modes is not None:
        # Ignore a stored mode the catalog no longer offers, so retiring one can't widen anything.
        allowed = frozenset(LearningModeId(mode) for mode in row.allowed_modes if mode in LearningModeId)
    return ActivePolicy(
        class_name=row.name,
        educator_name=row.educator_name,
        allowed_modes=allowed,
        answer_reveal=row.answer_reveal,
    )
