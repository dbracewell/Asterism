import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.settings.service import get_user_settings


async def resolve_main_agent_id(
    user_id: str,
    requested_agent_id: uuid.UUID | None,
    session: AsyncSession,
) -> uuid.UUID:
    if requested_agent_id is None:
        settings = await get_user_settings(user_id=user_id, session=session)
        requested_agent_id = settings.default_agent_id

    if requested_agent_id is None:
        raise BadDataException("Select a default main agent before starting a chat")

    agent = await get_agent_profile(
        user_id=user_id,
        agent_id=requested_agent_id,
        session=session,
    )
    if agent.sub_agent:
        raise BadDataException("A chat must use a main agent, not a sub-agent")
    return agent.id
