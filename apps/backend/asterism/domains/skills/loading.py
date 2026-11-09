"""Sub-agent skill catalog and live `load_skill` eligibility (ADR-0062).

A sub-agent sees the name and description of each skill assigned to its own
definition and loads one by name. Every load rechecks the admin policy and the
assignment, so a skill unassigned, deleted or switched off mid-run fails.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from asterism.core.exceptions import ForbiddenException, NotFoundException

from .models import AgentSkillModel, SkillModel
from .policy import read_policy
from .queries import select_owned_skills


def _assigned_to(user_id: str, agent_id: uuid.UUID):
    """Skills owned by ``user_id`` and assigned to that user's sub-agent ``agent_id``."""
    assigned = select(AgentSkillModel.skill_id).where(
        AgentSkillModel.user_id == user_id,
        AgentSkillModel.agent_id == agent_id,
        AgentSkillModel.sub_agent.is_(True),
    )
    return select_owned_skills(user_id).where(SkillModel.id.in_(assigned))


async def read_skill_catalog(user_id: str, agent_id: uuid.UUID, session: AsyncSession) -> list[SkillModel]:
    """The sub-agent's loadable skills by name, without their bodies; empty while skills are off."""
    if not (await read_policy(session)).enabled:
        return []
    rows = await session.scalars(
        _assigned_to(user_id, agent_id).options(defer(SkillModel.content)).order_by(SkillModel.name, SkillModel.id)
    )
    return list(rows)


async def load_assigned_skill(user_id: str, agent_id: uuid.UUID, name: str, session: AsyncSession) -> SkillModel:
    """The current skill named ``name`` if it is still assigned to the sub-agent and skills are on."""
    if not (await read_policy(session)).enabled:
        raise ForbiddenException("Skills are turned off by an administrator")
    row = await session.scalar(
        _assigned_to(user_id, agent_id).where(SkillModel.name == name.strip()).execution_options(populate_existing=True)
    )
    if row is None:
        raise NotFoundException(f"No skill named '{name}' is assigned to you; use a name from your skill catalog")
    return row
