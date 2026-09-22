import uuid

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.knowledge.schemas import KnowledgeBaseAssignmentList, KnowledgeBaseAssignmentReplace
from asterism.domains.knowledge.service import (
    get_agent_knowledge_base_assignments,
    replace_agent_knowledge_base_assignments,
)
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import (
    AgentProfile,
    PartialAgentProfile,
    SubAgentTrace,
    UserAgents,
)
from .service import (
    delete_agent_profile,
    get_sub_agent_traces_by_parent_message,
    get_user_agents,
    upsert_agent_profile,
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


@agents_router.get(
    "/{agent_id}/knowledge-bases",
    response_model=KnowledgeBaseAssignmentList,
    operation_id="agentKnowledgeBaseAssignmentsGet",
)
async def get_knowledge_base_assignments(
    agent_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep
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
        user_id=user.id, agent_id=agent_id, payload=payload, session=session
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
