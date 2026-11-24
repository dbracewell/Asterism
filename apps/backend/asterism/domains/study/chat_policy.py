"""The admin switch for decks and quizzes from chat (EPIC-98).

Unlike most features it is on by default: the tools only draft decks and
quizzes that the person reviews and saves, in a project whose Study area is on.
A malformed stored value still reads as off, so a bad write never widens it.
"""

import uuid

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_app_setting

from .chat_policy_schemas import StudyChatPolicy

POLICY_KEY = "study_chat"


async def read_policy(session: AsyncSession) -> StudyChatPolicy:
    row = await session.get(ApplicationSettingsModel, POLICY_KEY)
    if row is None:
        return StudyChatPolicy()
    if not isinstance(row.value, dict):
        return StudyChatPolicy(enabled=False)
    try:
        return StudyChatPolicy.model_validate(row.value)
    except ValidationError:
        return StudyChatPolicy(enabled=False)


async def write_policy(payload: StudyChatPolicy, session: AsyncSession) -> StudyChatPolicy:
    if payload.group_ids is not None:
        from asterism.domains.groups.service import list_groups

        known = {group.id for group in await list_groups(session)}
        if unknown := set(payload.group_ids) - known:
            raise BadDataException(f"Unknown groups: {', '.join(sorted(unknown))}")
        payload = payload.model_copy(update={"group_ids": sorted(set(payload.group_ids))})
    await upsert_app_setting(POLICY_KEY, payload.model_dump(mode="json"), session=session)
    return await read_policy(session)


async def study_chat_allowed(user_id: str, session: AsyncSession) -> tuple[bool, str]:
    """The admin's switch for this person: the policy and their group."""
    from asterism.domains.groups.service import read_group_id

    policy = await read_policy(session)
    if not policy.enabled:
        return False, "Your administrator has turned off decks and quizzes from chat"
    if policy.group_ids is not None and await read_group_id(user_id, session) not in policy.group_ids:
        return False, "Decks and quizzes from chat aren't available to your group"
    return True, ""


async def chat_study_available(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> tuple[bool, str]:
    """Whether the assistant may draft decks and quizzes in this chat (ADR-0080), read live.

    An ordinary conversation in the person's project, the project's Study area
    on, the admin switch for this person, and the course's class switch.
    """
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats
    from asterism.domains.courses.policy import course_mode_policy
    from asterism.domains.projects.models import ProjectModel
    from asterism.domains.projects.queries import select_owned_projects

    row = (
        await session.execute(
            select_owned_chats(user_id=user_id)
            .with_only_columns(ChatModel.purpose, ChatModel.project_id)
            .where(ChatModel.id == chat_id)
        )
    ).first()
    if row is None or row.purpose != "conversation" or row.project_id is None:
        return False, "Decks and quizzes can be drafted only in a project's chats"
    areas = await session.scalar(
        select_owned_projects(user_id=user_id)
        .with_only_columns(ProjectModel.areas)
        .where(ProjectModel.id == row.project_id)
    )
    if areas is None or not areas.study:
        return False, "This project's Study area is off"
    allowed, reason = await study_chat_allowed(user_id, session)
    if not allowed:
        return False, reason
    course = await course_mode_policy(user_id=user_id, project_id=row.project_id, session=session)
    if course is not None and not course.study_chat_enabled:
        return False, f"{course.educator_name} has turned off decks and quizzes from chat in this course"
    return True, ""
