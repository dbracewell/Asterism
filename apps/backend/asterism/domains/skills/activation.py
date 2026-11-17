"""Owned, assigned, policy-allowed instruction resolution for chat composition."""

import uuid

from sqlalchemy import Select, select
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


def _select_assigned_skills(user_id: str, ids: list[uuid.UUID]) -> Select[tuple[SkillModel]]:
    """Owned skills among ``ids`` that are assigned to the user's main agent."""
    assignments = (
        select(AgentSkillModel.skill_id)
        .join(AgentProfileModel, AgentProfileModel.id == AgentSkillModel.agent_id)
        .where(
            AgentSkillModel.user_id == user_id,
            AgentProfileModel.user_id == user_id,
            AgentProfileModel.sub_agent.is_(False),
        )
    )
    return select_owned_skills(user_id).where(SkillModel.id.in_(ids), SkillModel.id.in_(assignments))


async def eligible_rows(user_id: str, ids: list[uuid.UUID], session: AsyncSession) -> dict[uuid.UUID, SkillModel]:
    if not ids:
        return {}
    if not (await read_policy(session)).enabled:
        raise CodedException(409, "Skills are disabled; remove active skills before retrying")
    rows = list(await session.scalars(_select_assigned_skills(user_id, ids).execution_options(populate_existing=True)))
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


async def available_skill_ids(
    user_id: str, snapshots: tuple[SkillSnapshot, ...], session: AsyncSession
) -> set[uuid.UUID]:
    """Ids of the snapshots that would each pass ``validate_snapshots`` on their own.

    Reads the policy once and checks eligibility in one query instead of
    validating each snapshot separately.
    """
    if not snapshots or not (await read_policy(session)).enabled:
        return set()
    within_limits = []
    for item in snapshots:
        try:
            validate_limits((item,))
        except CodedException:
            continue
        within_limits.append(item.id)
    if not within_limits:
        return set()
    statement = _select_assigned_skills(user_id, within_limits).with_only_columns(SkillModel.id)
    return set(await session.scalars(statement))
