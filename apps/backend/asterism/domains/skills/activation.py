"""Owned, assigned, policy-allowed instruction resolution for chat composition."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.skill_inputs import (
    MAX_ACTIVE_SKILL_BYTES,
    MAX_ACTIVE_SKILLS,
    MAX_SKILL_BYTES,
    SkillSnapshot,
)

from .models import AgentSkillModel, SkillModel
from .policy import read_policy
from .queries import select_owned_skills


async def eligible_rows(user_id: str, ids: list[uuid.UUID], session: AsyncSession) -> dict[uuid.UUID, SkillModel]:
    if not ids:
        return {}
    if not (await read_policy(session)).enabled:
        raise CodedException(409, "Skills are disabled; remove active skills before retrying")
    assignments = (
        select(AgentSkillModel.skill_id)
        .join(AgentProfileModel, AgentProfileModel.id == AgentSkillModel.agent_id)
        .where(
            AgentSkillModel.user_id == user_id,
            AgentProfileModel.user_id == user_id,
            AgentProfileModel.sub_agent.is_(False),
        )
    )
    rows = list(
        await session.scalars(
            select_owned_skills(user_id)
            .where(SkillModel.id.in_(ids), SkillModel.id.in_(assignments))
            .execution_options(populate_existing=True)
        )
    )
    if {row.id for row in rows} != set(ids):
        raise CodedException(409, "An active skill is unavailable or unassigned; remove it before retrying")
    return {row.id: row for row in rows}


def validate_limits(snapshots: tuple[SkillSnapshot, ...]) -> None:
    sizes = [len(item.content.encode()) for item in snapshots]
    if len(snapshots) > MAX_ACTIVE_SKILLS or any(size > MAX_SKILL_BYTES for size in sizes):
        raise CodedException(422, "At most 8 active skills of 65536 UTF-8 bytes each are allowed")
    if sum(sizes) > MAX_ACTIVE_SKILL_BYTES:
        raise CodedException(422, "Active skills exceed the 131072 UTF-8 byte context budget; remove skills")


async def validate_snapshots(user_id: str, snapshots: tuple[SkillSnapshot, ...], session: AsyncSession) -> None:
    validate_limits(snapshots)
    await eligible_rows(user_id, [item.id for item in snapshots], session)
