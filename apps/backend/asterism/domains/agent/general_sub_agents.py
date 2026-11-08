"""The sub-agents a user's main agent may delegate to in General chats (ADR-0059).

The set is ordered, owner-consistent (DB-enforced) and guarded by its own
revision on the main configuration row. Delegation reads it live; it grants
nothing by itself beyond eligibility.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException

from .models import AgentProfileModel, GeneralSubAgentModel
from .queries import select_owned_agent_profiles

logger = get_logger("GeneralSubAgents")


@dataclass(frozen=True)
class GeneralSet:
    revision: int
    agent_ids: tuple[uuid.UUID, ...]


async def _main_row(user_id: str, session: AsyncSession) -> AgentProfileModel:
    row = await session.scalar(
        select_owned_agent_profiles(user_id)
        .where(AgentProfileModel.sub_agent.is_(False))
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise NotFoundException("Main configuration not provisioned")
    return row


async def read_general_set(user_id: str, session: AsyncSession) -> GeneralSet:
    """The live ordered set and its revision."""
    main = await _main_row(user_id, session)
    ids = await session.scalars(
        select(GeneralSubAgentModel.agent_id)
        .where(GeneralSubAgentModel.user_id == user_id)
        .order_by(GeneralSubAgentModel.position)
    )
    return GeneralSet(revision=main.general_sub_agents_revision, agent_ids=tuple(ids))


async def replace_general_set(
    *, user_id: str, agent_ids: list[uuid.UUID], expected_revision: int, session: AsyncSession
) -> None:
    """Replace the ordered set. Only a real change bumps the revision."""
    if len(set(agent_ids)) != len(agent_ids):
        raise BadDataException("Each sub-agent can appear only once")
    current = await read_general_set(user_id, session)
    if current.revision != expected_revision:
        raise ConflictException("General chat sub-agents changed; reload and try again")
    owned = set(
        await session.scalars(
            select_owned_agent_profiles(user_id)
            .with_only_columns(AgentProfileModel.id)
            .where(AgentProfileModel.sub_agent.is_(True), AgentProfileModel.id.in_(agent_ids))
        )
    )
    if missing := [agent_id for agent_id in agent_ids if agent_id not in owned]:
        raise NotFoundException(f"Sub-agent not found: {missing[0]}")
    if tuple(agent_ids) != current.agent_ids:
        main = await _main_row(user_id, session)
        bumped = await session.execute(
            update(AgentProfileModel)
            .where(
                AgentProfileModel.id == main.id,
                AgentProfileModel.general_sub_agents_revision == expected_revision,
            )
            .values(general_sub_agents_revision=AgentProfileModel.general_sub_agents_revision + 1)
        )
        if not getattr(bumped, "rowcount", 0):
            await session.rollback()
            raise ConflictException("General chat sub-agents changed; reload and try again")
        await session.execute(delete(GeneralSubAgentModel).where(GeneralSubAgentModel.user_id == user_id))
        await session.flush()
        session.add_all(
            GeneralSubAgentModel(user_id=user_id, agent_id=agent_id, position=position)
            for position, agent_id in enumerate(agent_ids)
        )
        await session.commit()
        logger.info(f"User {user_id} set {len(agent_ids)} General chat sub-agent(s)")


async def revoke_general_target(*, user_id: str, agent_id: uuid.UUID, session: AsyncSession) -> None:
    """Before a definition is deleted: bump the revision if it was in the set (no commit)."""
    listed = await session.scalar(
        select(GeneralSubAgentModel.agent_id).where(
            GeneralSubAgentModel.user_id == user_id, GeneralSubAgentModel.agent_id == agent_id
        )
    )
    if listed is not None:
        main = await _main_row(user_id, session)
        main.general_sub_agents_revision = main.general_sub_agents_revision + 1
        await session.execute(
            delete(GeneralSubAgentModel).where(
                GeneralSubAgentModel.user_id == user_id, GeneralSubAgentModel.agent_id == agent_id
            )
        )
