"""Whether memory is used: the admin policy, the person's group and setting, and the course (ADR-0078).

Every switch is read live. Memory is used only when all of them allow it, and the
first one that doesn't is reported, so people see why.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.settings.models import UserSettingModel

from .access import POLICY_KEY, memory_allowed, read_policy
from .schemas import MemoryAvailability, MemorySwitch

# The person's "Use memory" setting; unset means on.
USER_SETTING_KEY = "memory_enabled"

__all__ = ["POLICY_KEY", "USER_SETTING_KEY", "chat_memory_available", "memory_available", "read_policy"]


async def personal_memory_enabled(user_id: str, session: AsyncSession) -> bool:
    value = await session.scalar(
        select(UserSettingModel.value).where(
            UserSettingModel.user_id == user_id, UserSettingModel.key == USER_SETTING_KEY
        )
    )
    return value is not False


async def memory_available(
    user_id: str, session: AsyncSession, *, project_id: uuid.UUID | None = None
) -> MemoryAvailability:
    """The one check for reading and proposing memories, in a chat or a new chat.

    ``project_id`` is the chat's project, or None for General. Pass the live
    project of the chat being sent, resumed or regenerated.
    """
    allowed = await memory_allowed(user_id, session)
    if not allowed.available:
        return allowed
    if not await personal_memory_enabled(user_id, session):
        return MemoryAvailability(
            available=False, off_by=MemorySwitch.PERSONAL, reason="You've turned memory off in Your Asterism"
        )
    if project_id is not None:
        from asterism.domains.courses.policy import course_mode_policy

        course = await course_mode_policy(user_id=user_id, project_id=project_id, session=session)
        if course is not None and not course.memory_enabled:
            return MemoryAvailability(
                available=False,
                off_by=MemorySwitch.COURSE,
                reason=f"{course.class_name} ({course.educator_name}) has turned memory off for this course",
            )
    return MemoryAvailability(available=True)


async def chat_memory_available(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> MemoryAvailability:
    """``memory_available`` for one of the user's chats, with its live project."""
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats

    chat = await session.scalar(select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id))
    if chat is None:
        return MemoryAvailability(available=False, reason="Chat not found")
    return await memory_available(user_id, session, project_id=chat.project_id)
