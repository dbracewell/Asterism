import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import (
    BadDataException,
    NotFoundException,
    UnauthorizedException,
)
from asterism.db.database import get_async_db_session
from asterism.domains.chat.models import ChatModel
from asterism.domains.knowledge.assignments import AgentKnowledgeBaseAssignmentModel
from asterism.domains.knowledge.models import KnowledgeBaseModel
from asterism.domains.settings import service as settings_service
from asterism.domains.settings.models import UserSettingModel

from .models import AgentProfileModel, SubAgentTraceModel
from .schemas import (
    AgentProfile,
    KnowledgeBaseAssignmentSummary,
    PartialAgentProfile,
    SubAgentTrace,
    SubAgentTraceCreate,
    UserAgents,
)


async def _assignment_summaries(
    *, user_id: str, agent_id: uuid.UUID, session: AsyncSession
) -> list[KnowledgeBaseAssignmentSummary]:
    rows = await session.execute(
        select(KnowledgeBaseModel.id, KnowledgeBaseModel.name)
        .join(
            AgentKnowledgeBaseAssignmentModel,
            AgentKnowledgeBaseAssignmentModel.knowledge_base_id == KnowledgeBaseModel.id,
        )
        .where(
            AgentKnowledgeBaseAssignmentModel.user_id == user_id,
            AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
            KnowledgeBaseModel.user_id == user_id,
        )
        .order_by(AgentKnowledgeBaseAssignmentModel.position)
    )
    return [KnowledgeBaseAssignmentSummary(id=row.id, name=row.name) for row in rows]


async def _with_assignment_summaries(profile: AgentProfile, *, user_id: str, session: AsyncSession) -> AgentProfile:
    profile.knowledge_bases = await _assignment_summaries(user_id=user_id, agent_id=profile.id, session=session)
    return profile


async def _ensure_valid_tools(
    profile: AgentProfile,
    session: AsyncSession | None = None,
) -> AgentProfile:
    app_settings = await settings_service.get_app_settings(session=session)
    if profile.tools:
        profile.tools = [t for t in profile.tools if t in app_settings.active_tools]
    return profile


async def get_user_agents(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserAgents:
    async with get_async_db_session(session) as session:
        stmt = select(AgentProfileModel).where(AgentProfileModel.user_id == user_id)
        results = await session.scalars(stmt)

        agents_dict: dict[uuid.UUID, AgentProfile] = {}
        for r in results:
            profile = await _ensure_valid_tools(AgentProfile.model_validate(r), session=session)
            agents_dict[r.id] = await _with_assignment_summaries(profile, user_id=user_id, session=session)

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
        profile = await _ensure_valid_tools(AgentProfile.model_validate(result), session=session)
        return await _with_assignment_summaries(profile, user_id=user_id, session=session)


async def delete_agent_profile(
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
        if not result.sub_agent:
            await _ensure_main_agent_can_be_removed(user_id, result.id, session)
        await session.delete(result)
        await session.commit()
        return AgentProfile.model_validate(result)


async def upsert_agent_profile(
    user_id: str,
    agent_profile: PartialAgentProfile,
    session: AsyncSession | None = None,
) -> AgentProfile:
    # Interactive main agents must be able to delegate to configured workers.
    # Keep this server-side so API clients cannot bypass the UI constraint.
    if not agent_profile.sub_agent and "sub_agent" not in (agent_profile.tools or []):
        agent_profile.tools = [*(agent_profile.tools or []), "sub_agent"]

    async with get_async_db_session(session) as session:
        if agent_profile.id:
            result = await session.get(AgentProfileModel, agent_profile.id)
            if not result:
                raise NotFoundException(f"Agent with id {agent_profile.id} not found")
            if user_id != result.user_id:
                raise UnauthorizedException()
            if not result.sub_agent and agent_profile.sub_agent:
                await _ensure_main_agent_can_be_removed(user_id, result.id, session)
            result.chat_parameters = agent_profile.chat_parameters
            result.description = agent_profile.description
            result.name = agent_profile.name
            result.sub_agent = agent_profile.sub_agent
            if agent_profile.model_id is None:
                raise ValueError("model_id cannot be None when updating an agent profile")
            result.model_id = agent_profile.model_id
            result.max_steps = agent_profile.max_steps
            result.system_prompt = agent_profile.system_prompt
            result.tools = agent_profile.tools
            await session.commit()
        else:
            result = AgentProfileModel(**agent_profile.model_dump())
            result.user_id = user_id
            session.add(result)
            await session.commit()
            await session.refresh(result)

        profile = AgentProfile.model_validate(result)
        return await _with_assignment_summaries(profile, user_id=user_id, session=session)


async def _ensure_main_agent_can_be_removed(
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession,
) -> None:
    assigned_chat_id = await session.scalar(
        select(ChatModel.id)
        .where(
            ChatModel.user_id == user_id,
            ChatModel.agent_id == agent_id,
        )
        .limit(1)
    )
    if assigned_chat_id is not None:
        raise BadDataException("This main agent is assigned to an existing chat and cannot be changed")

    main_agent_ids = list(
        await session.scalars(
            select(AgentProfileModel.id).where(
                AgentProfileModel.user_id == user_id,
                AgentProfileModel.sub_agent.is_(False),
            )
        )
    )
    if len(main_agent_ids) <= 1:
        raise BadDataException("A user must retain at least one main agent")

    default_agent_id = await session.scalar(
        select(UserSettingModel.value).where(
            UserSettingModel.user_id == user_id,
            UserSettingModel.key == "default_agent_id",
        )
    )
    if str(default_agent_id) not in {str(id) for id in main_agent_ids}:
        raise BadDataException("Select a valid default main agent before changing this agent")
    if str(default_agent_id) == str(agent_id):
        raise BadDataException("Select another default main agent before changing this agent")


async def create_sub_agent_trace(
    trace: SubAgentTraceCreate,
    session: AsyncSession | None = None,
) -> SubAgentTrace:
    async with get_async_db_session(session) as session:
        model = SubAgentTraceModel(
            user_id=trace.user_id,
            parent_message_id=trace.parent_message_id,
            sub_agent_id=trace.sub_agent_id,
            sub_agent_name=trace.sub_agent_name,
            prompt=trace.prompt,
            caller_context=trace.caller_context,
            messages=trace.messages,
            result=trace.result,
            step_count=trace.step_count,
            total_tokens=trace.total_tokens,
            elapsed_ms=trace.elapsed_ms,
            depth=trace.depth,
        )
        session.add(model)
        await session.commit()
        await session.refresh(model)
        return SubAgentTrace.model_validate(model)


async def get_sub_agent_traces_by_parent_message(
    user_id: str,
    parent_message_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> list[SubAgentTrace]:
    async with get_async_db_session(session) as session:
        stmt = (
            select(SubAgentTraceModel)
            .where(
                SubAgentTraceModel.user_id == user_id,
                SubAgentTraceModel.parent_message_id == parent_message_id,
            )
            .order_by(SubAgentTraceModel.created_at.asc())
        )
        results = await session.scalars(stmt)
        return [SubAgentTrace.model_validate(r) for r in results]
