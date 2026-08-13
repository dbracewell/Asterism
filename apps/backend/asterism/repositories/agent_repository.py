import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common import NotFoundException, UnauthorizedException
from asterism.db import get_async_db_session
from asterism.models import AgentProfileModel
from asterism.schemas import AgentProfile, PartialAgentProfile, UserAgents


async def get_user_agents(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserAgents:
    async with get_async_db_session(session) as session:
        stmt = select(AgentProfileModel).where(AgentProfileModel.user_id == user_id)
        results = await session.scalars(stmt)

        agents_dict: dict[uuid.UUID, AgentProfile] = {}
        for r in results:
            agents_dict[r.id] = AgentProfile.model_validate(r)

        return UserAgents(agents=agents_dict)


async def get_agent_profile(
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> AgentProfile:
    async with get_async_db_session(session) as session:
        result = await session.get(AgentProfileModel, agent_id)
        if not result:
            raise NotFoundException(f"Agent with id {agent_id} not found")
        if user_id != result.user_id:
            raise UnauthorizedException()
        return AgentProfile.model_validate(result)


async def upsert_agent_profile(
    agent_profile: PartialAgentProfile,
    session: AsyncSession | None = None,
) -> AgentProfile:
    async with get_async_db_session(session) as session:
        if agent_profile.id:
            result = await session.get(AgentProfileModel, agent_profile.id)
            if not result:
                raise NotFoundException(f"Agent with id {agent_profile.id} not found")
            if agent_profile.user_id != result.user_id:
                raise UnauthorizedException()
            result.chat_parameters = agent_profile.chat_parameters
            result.description = agent_profile.description
            result.name = agent_profile.name
            result.model_id = agent_profile.model_id
            result.max_steps = agent_profile.max_steps
            result.system_prompt = agent_profile.system_prompt
            result.tools = agent_profile.tools
            await session.commit()
            return AgentProfile.model_validate(result)

        new_profile = AgentProfileModel(**agent_profile.model_dump())
        session.add(new_profile)
        await session.commit()
        await session.refresh(new_profile)
        return AgentProfile.model_validate(new_profile)
