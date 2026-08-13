from fastapi import APIRouter

from asterism.common import ErrorDetail
from asterism.repositories.agent_repository import agent_repository
from asterism.schemas import UserAgents
from asterism.services.dependencies import (
    AuthedUserDep,
    DBSessionDep,
)

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
    return await agent_repository.get_user_agents(
        user_id=user.id,
        session=session,
    )
