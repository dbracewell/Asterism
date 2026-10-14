import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.knowledge_base.schemas import KnowledgeBaseAssignmentList, KnowledgeBaseAssignmentReplace
from asterism.domains.knowledge_base.service import (
    get_agent_knowledge_base_assignments,
    replace_agent_knowledge_base_assignments,
)
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import SubAgentCreate, SubAgentDefinition, SubAgentTrace
from .service import delete_agent_profile, get_sub_agent_traces_by_parent_message, get_sub_agents, save_sub_agent

agents_router = APIRouter(
    prefix="/agents",
    tags=["agents"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@agents_router.get("/sub-agents", response_model=list[SubAgentDefinition], operation_id="subAgentsList")
async def list_sub_agents(user: AuthedUserDep, session: DBSessionDep) -> list[SubAgentDefinition]:
    return await get_sub_agents(user.id, session)


@agents_router.post("/sub-agents", response_model=SubAgentDefinition, operation_id="subAgentCreate", status_code=201)
async def create_sub_agent(payload: SubAgentCreate, user: AuthedUserDep, session: DBSessionDep) -> SubAgentDefinition:
    return await save_sub_agent(user.id, payload, session=session)


@agents_router.put("/sub-agents/{agent_id}", response_model=SubAgentDefinition, operation_id="subAgentUpdate")
async def update_sub_agent(
    agent_id: uuid.UUID, payload: SubAgentCreate, user: AuthedUserDep, session: DBSessionDep,
) -> SubAgentDefinition:
    return await save_sub_agent(user.id, payload, agent_id=agent_id, session=session)


@agents_router.get(
    "/{agent_id}/knowledge-bases",
    response_model=KnowledgeBaseAssignmentList,
    operation_id="agentKnowledgeBaseAssignmentsGet",
)
async def get_knowledge_base_assignments(
    agent_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> KnowledgeBaseAssignmentList:
    return await get_agent_knowledge_base_assignments(user_id=user.id, agent_id=agent_id, session=session)


@agents_router.put(
    "/{agent_id}/knowledge-bases",
    response_model=KnowledgeBaseAssignmentList,
    operation_id="agentKnowledgeBaseAssignmentsReplace",
)
async def replace_knowledge_base_assignments(
    agent_id: uuid.UUID,
    payload: KnowledgeBaseAssignmentReplace,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> KnowledgeBaseAssignmentList:
    return await replace_agent_knowledge_base_assignments(
        user_id=user.id,
        agent_id=agent_id,
        payload=payload,
        session=session,
    )


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
