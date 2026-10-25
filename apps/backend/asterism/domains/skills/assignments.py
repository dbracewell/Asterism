"""Explicit main-agent eligibility; assignment never grants other capabilities."""

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.queries import select_owned_agent_profiles

from .models import AgentSkillModel, SkillModel
from .policy import read_policy
from .queries import search_owned_skills, select_owned_assignments, select_owned_skills
from .schemas import EligibleSkillsPage, SkillAssignments, SkillAssignmentUpdate, SkillSummary

logger = get_logger("SkillAssignments")


async def _main_agent(user_id: str, session: AsyncSession) -> AgentProfileModel:
    row = await session.scalar(select_owned_agent_profiles(user_id).where(AgentProfileModel.sub_agent.is_(False)))
    if row is None:
        raise NotFoundException("Main agent configuration not provisioned")
    return row


async def read_assignments(user_id: str, session: AsyncSession) -> SkillAssignments:
    agent = await _main_agent(user_id, session)
    rows = await session.scalars(
        select_owned_assignments(user_id).where(AgentSkillModel.agent_id == agent.id).order_by(AgentSkillModel.skill_id)
    )
    return SkillAssignments(skill_ids=[row.skill_id for row in rows], revision=agent.config_revision)


async def replace_assignments(user_id: str, payload: SkillAssignmentUpdate, session: AsyncSession) -> SkillAssignments:
    agent = await _main_agent(user_id, session)
    skill_ids = set(payload.skill_ids)
    if len(skill_ids) != len(payload.skill_ids):
        raise BadDataException("Assigned skills must be unique")
    owned = set(
        await session.scalars(
            select_owned_skills(user_id).with_only_columns(SkillModel.id).where(SkillModel.id.in_(skill_ids))
        )
    )
    if owned != skill_ids:
        raise NotFoundException("One or more skills not found")
    try:
        changed = await session.execute(
            update(AgentProfileModel)
            .where(
                AgentProfileModel.id == agent.id,
                AgentProfileModel.user_id == user_id,
                AgentProfileModel.sub_agent.is_(False),
                AgentProfileModel.config_revision == payload.expected_revision,
            )
            .values(config_revision=AgentProfileModel.config_revision + 1)
            .returning(AgentProfileModel.id)
            .execution_options(synchronize_session="fetch")
        )
        if changed.scalar_one_or_none() is None:
            raise ConflictException("Main agent changed; reload before assigning skills")
        await session.execute(
            delete(AgentSkillModel).where(AgentSkillModel.agent_id == agent.id, AgentSkillModel.user_id == user_id)
        )
        session.add_all(
            [AgentSkillModel(agent_id=agent.id, user_id=user_id, skill_id=skill_id) for skill_id in skill_ids]
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException("Skill assignments changed; reload before retrying") from exc
    except ConflictException:
        await session.rollback()
        raise
    logger.info(f"Replaced {len(skill_ids)} assigned skills for user {user_id}")
    return await read_assignments(user_id, session)


async def list_eligible_skills(
    user_id: str, session: AsyncSession, *, query: str, page: int, page_size: int
) -> EligibleSkillsPage:
    agent = await _main_agent(user_id, session)
    policy = await read_policy(session)
    assigned = select(AgentSkillModel.skill_id).where(
        AgentSkillModel.user_id == user_id, AgentSkillModel.agent_id == agent.id, AgentSkillModel.sub_agent.is_(False)
    )
    statement = search_owned_skills(user_id, query).where(SkillModel.id.in_(assigned), policy.enabled)
    result = await paginate_select(
        statement=statement.options(defer(SkillModel.content)), session=session, page=page, page_size=page_size
    )
    return EligibleSkillsPage(
        items=[SkillSummary.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
        policy_enabled=policy.enabled,
        agent_revision=agent.config_revision,
    )
