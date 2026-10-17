import uuid

from fastapi import APIRouter, Query

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import SubAgentCreate, SubAgentDefinition, SubAgentList, SubAgentTrace
from .service import delete_agent_profile, get_sub_agent_traces_by_parent_message, save_sub_agent
from .service import list_sub_agents as list_owned_sub_agents

agents_router = APIRouter(
    prefix="/agents",
    tags=["agents"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@agents_router.get("/sub-agents", response_model=SubAgentList, operation_id="subAgentsList")
async def list_sub_agents(
    user: AuthedUserDep,
    session: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> SubAgentList:
    return await list_owned_sub_agents(user.id, session, page=page, page_size=page_size)


@agents_router.post("/sub-agents", response_model=SubAgentDefinition, operation_id="subAgentCreate", status_code=201)
async def create_sub_agent(payload: SubAgentCreate, user: AuthedUserDep, session: DBSessionDep) -> SubAgentDefinition:
    return await save_sub_agent(user.id, payload, session=session)


@agents_router.put("/sub-agents/{agent_id}", response_model=SubAgentDefinition, operation_id="subAgentUpdate")
async def update_sub_agent(
    agent_id: uuid.UUID,
    payload: SubAgentCreate,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> SubAgentDefinition:
    return await save_sub_agent(user.id, payload, agent_id=agent_id, session=session)


@agents_router.get(
    "/traces/{parent_message_id}",
    response_model=list[SubAgentTrace],
    operation_id="agentsGetSubAgentTraces",
    summary="Get sub-agent execution traces for a parent message",
)
async def get_traces_for_parent_message(
    parent_message_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> list[SubAgentTrace]:
    return await get_sub_agent_traces_by_parent_message(
        user_id=user.id,
        parent_message_id=parent_message_id,
        session=session,
    )


@agents_router.delete(
    "/sub-agents/{agent_id}",
    response_model=SubAgentDefinition,
    operation_id="subAgentDelete",
    summary="Delete an agent",
)
async def delete_agent(
    agent_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> SubAgentDefinition:
    return await delete_agent_profile(
        user_id=user.id,
        agent_id=agent_id,
        session=session,
    )
