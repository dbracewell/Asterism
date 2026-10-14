import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.agent.service import get_main_agent_profile


async def resolve_main_agent_id(user_id: str, session: AsyncSession) -> uuid.UUID:
    return (await get_main_agent_profile(user_id, session)).id
