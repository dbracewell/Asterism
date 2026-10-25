"""Document lifecycle and paginated reads. No activation or runtime prompt changes."""

import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.agent.models import AgentProfileModel

from .documents import parse_document
from .models import AgentSkillModel, SkillModel
from .queries import search_owned_skills, select_owned_skills
from .schemas import Skill, SkillCreate, SkillPage, SkillSummary, SkillUpdate

logger = get_logger("Skills")


async def require_skill(user_id: str, skill_id: uuid.UUID, session: AsyncSession) -> SkillModel:
    row = await session.scalar(select_owned_skills(user_id).where(SkillModel.id == skill_id))
    if row is None:
        raise NotFoundException("Skill not found")
    return row


async def list_skills(user_id: str, session: AsyncSession, *, query: str, page: int, page_size: int) -> SkillPage:
    result = await paginate_select(
        statement=search_owned_skills(user_id, query).options(defer(SkillModel.content)),
        session=session,
        page=page,
        page_size=page_size,
    )
    return SkillPage(
        items=[SkillSummary.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def create_skill(user_id: str, payload: SkillCreate, session: AsyncSession) -> Skill:
    metadata = parse_document(payload.content)
    row = SkillModel(user_id=user_id, content=payload.content, name=metadata.name, description=metadata.description)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException("A skill with that name already exists") from exc
    await session.refresh(row)
    logger.info(f"Created skill {row.id} for user {user_id}")
    return Skill.model_validate(row)


async def update_skill(user_id: str, skill_id: uuid.UUID, payload: SkillUpdate, session: AsyncSession) -> Skill:
    await require_skill(user_id, skill_id, session)
    metadata = parse_document(payload.content)
    try:
        result = await session.execute(
            update(SkillModel)
            .where(
                SkillModel.id == skill_id,
                SkillModel.user_id == user_id,
                SkillModel.revision == payload.expected_revision,
            )
            .values(
                content=payload.content,
                name=metadata.name,
                description=metadata.description,
                revision=SkillModel.revision + 1,
            )
            .returning(SkillModel.id)
            .execution_options(synchronize_session="fetch")
        )
        if result.scalar_one_or_none() is None:
            raise ConflictException("Skill changed; reload before saving")
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException("A skill with that name already exists") from exc
    logger.info(f"Updated skill {skill_id} for user {user_id}")
    return Skill.model_validate(await require_skill(user_id, skill_id, session))


async def delete_skill(user_id: str, skill_id: uuid.UUID, expected_revision: int, session: AsyncSession) -> None:
    await require_skill(user_id, skill_id, session)
    # Mark assignment-set changes before FK cascades remove the corresponding rows.
    agent_ids = select(AgentSkillModel.agent_id).where(
        AgentSkillModel.user_id == user_id, AgentSkillModel.skill_id == skill_id
    )
    try:
        await session.execute(
            update(AgentProfileModel)
            .where(AgentProfileModel.user_id == user_id, AgentProfileModel.id.in_(agent_ids))
            .values(config_revision=AgentProfileModel.config_revision + 1)
        )
        result = await session.execute(
            delete(SkillModel)
            .where(SkillModel.id == skill_id, SkillModel.user_id == user_id, SkillModel.revision == expected_revision)
            .returning(SkillModel.id)
        )
        if result.scalar_one_or_none() is None:
            raise ConflictException("Skill changed; reload before deleting")
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    logger.info(f"Deleted skill {skill_id} for user {user_id}")
