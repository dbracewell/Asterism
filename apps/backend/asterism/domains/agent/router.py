import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import AgentProfile, PartialAgentProfile, UserAgents
from .service import delete_agent_profile, get_user_agents, upsert_agent_profile

agents_router = APIRouter(
    prefix="/agents",
    tags=["agents"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@agents_router.get(
    "",
    response_model=UserAgents,
    operation_id="agentsGetUserAgents",
    summary="Gets all agents defined by a user",
)
async def get_many(
    user: AuthedUserDep,
    session: DBSessionDep,
) -> UserAgents:
    return await get_user_agents(
        user_id=user.id,
        session=session,
    )


@agents_router.post(
    "",
    response_model=AgentProfile,
    operation_id="agentsUpsertAgentProfile",
    summary="Creates or updates an agent",
)
async def create_agent(
    user: AuthedUserDep,
    payload: PartialAgentProfile,
    session: DBSessionDep,
) -> AgentProfile:
    return await upsert_agent_profile(
        user_id=user.id,
        agent_profile=payload,
        session=session,
    )


@agents_router.delete(
    "/{agent_id}",
    response_model=AgentProfile,
    operation_id="agentsDeleteAgent",
    summary="Delete an agent",
)
async def delete_agent(
    agent_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> AgentProfile:
    return await delete_agent_profile(
        user_id=user.id,
        agent_id=agent_id,
        session=session,
    )
