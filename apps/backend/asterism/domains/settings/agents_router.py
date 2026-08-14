from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import UserAgents
from .service import get_user_agents

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
