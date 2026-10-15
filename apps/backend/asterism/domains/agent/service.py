import uuid
from typing import cast

from sqlalchemy import select, text, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import (
    BadDataException,
    NotFoundException,
    UnauthorizedException,
)
from asterism.db.database import get_async_db_session
from asterism.domains.knowledge_base.models import AgentKnowledgeBaseAssignmentModel, KnowledgeBaseModel
from asterism.domains.llm.schemas import ChatCompletionParams
from asterism.domains.settings.models import LLMModel
from asterism.domains.user.models import UserModel

from .models import AgentProfileModel, SubAgentTraceModel
from .queries import select_owned_agent_profiles
from .schemas import (
    AgentProfile,
    KnowledgeBaseAssignmentSummary,
    MainAgentConfiguration,
    MainAgentUpdate,
    SubAgentCreate,
    SubAgentDefinition,
    SubAgentTrace,
    SubAgentTraceCreate,
    UserAgents,
)


async def _assignment_summaries(
    *,
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession,
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
        .order_by(AgentKnowledgeBaseAssignmentModel.position),
    )
    return [KnowledgeBaseAssignmentSummary(id=row.id, name=row.name) for row in rows]


async def _with_assignment_summaries(profile: AgentProfile, *, user_id: str, session: AsyncSession) -> AgentProfile:
    profile.knowledge_bases = await _assignment_summaries(user_id=user_id, agent_id=profile.id, session=session)
    return profile


async def _ensure_valid_tools(
    profile: AgentProfile,
    session: AsyncSession | None = None,
) -> AgentProfile:
    from asterism.domains.settings.tool_settings import get_tool_settings

    app_settings = await get_tool_settings(session=session)
    if profile.tools:
        profile.tools = [t for t in profile.tools if t in app_settings.active_tools]
        if profile.knowledge_bases:
            profile.tools.append("search_knowledge")
    return profile


async def get_user_agents(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserAgents:
    async with get_async_db_session(session) as session:
        stmt = select_owned_agent_profiles(user_id)
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


async def provision_main_agent(user_id: str, session: AsyncSession) -> None:
    """Idempotent provisioning inside the user's transaction, protected by a unique index."""
    existing = await session.scalar(
        select(AgentProfileModel.id).where(
            AgentProfileModel.user_id == user_id,
            AgentProfileModel.sub_agent.is_(False),
        ),
    )
    if existing is not None:
        return
    if await session.get(UserModel, user_id) is None:
        raise NotFoundException("User not found")
    await session.execute(
        insert(AgentProfileModel)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            sub_agent=False,
            model_id=None,
            name="Main agent",
            description="Your main chat configuration",
            system_prompt="",
            max_steps=5,
            chat_parameters={},
            tools=[],
        )
        .on_conflict_do_nothing(index_elements=["user_id"], index_where=text("sub_agent = false")),
    )


async def get_main_agent_profile(user_id: str, session: AsyncSession | None = None) -> AgentProfile:
    async with get_async_db_session(session) as session:
        result = await session.scalar(
            select_owned_agent_profiles(user_id).where(AgentProfileModel.sub_agent.is_(False)),
        )
        if result is None:
            raise NotFoundException("Main agent configuration not provisioned")
        return await get_agent_profile(user_id, result.id, session)


async def get_main_agent(user_id: str, session: AsyncSession | None = None) -> MainAgentConfiguration:
    async with get_async_db_session(session) as session:
        row = await session.scalar(select_owned_agent_profiles(user_id).where(AgentProfileModel.sub_agent.is_(False)))
        if row is None:
            raise NotFoundException("Main configuration not provisioned")
        result = MainAgentConfiguration.model_validate(row)
        result.knowledge_bases = await _assignment_summaries(user_id=user_id, agent_id=row.id, session=session)
        return result


async def _validate_configuration(payload: MainAgentUpdate, session: AsyncSession) -> None:
    from asterism.domains.settings.tool_settings import get_tool_settings

    settings = await get_tool_settings(session=session)
    from asterism.domains.tools.catalog import registered_tool_names

    invalid = set(payload.tools) - (set(settings.active_tools) & registered_tool_names)
    if invalid:
        raise BadDataException(f"Unavailable tools: {', '.join(sorted(invalid))}")
    if len(payload.tools) != len(set(payload.tools)):
        raise BadDataException("Tools must be unique")
    if isinstance(payload, SubAgentCreate):
        model = await session.get(LLMModel, payload.model_id)
        if model is None or not model.is_active:
            raise BadDataException("Sub-agent model must be available and active")


async def update_main_agent(
    user_id: str,
    payload: MainAgentUpdate,
    session: AsyncSession | None = None,
) -> MainAgentConfiguration:
    async with get_async_db_session(session) as session:
        await _validate_configuration(payload, session)
        profile = await get_main_agent_profile(user_id, session)
        row = await session.get(AgentProfileModel, profile.id)
        assert row is not None
        values = payload.model_dump()
        values["chat_parameters"] = payload.chat_parameters.model_dump(exclude_none=True)
        await session.execute(
            update(AgentProfileModel)
            .where(
                AgentProfileModel.id == row.id,
                AgentProfileModel.user_id == user_id,
            )
            .values(**values, config_revision=AgentProfileModel.config_revision + 1)
            .execution_options(synchronize_session="fetch"),
        )
        await session.commit()
        return await get_main_agent(user_id, session)


async def _sub_definition(profile: AgentProfile, session: AsyncSession) -> SubAgentDefinition:
    model = await session.get(LLMModel, profile.model_id)
    return SubAgentDefinition.model_validate(
        {**profile.model_dump(exclude={"sub_agent"}), "model_available": model is not None and model.is_active},
    )


async def get_sub_agents(user_id: str, session: AsyncSession | None = None) -> list[SubAgentDefinition]:
    async with get_async_db_session(session) as session:
        rows = await session.scalars(
            select_owned_agent_profiles(user_id)
            .where(AgentProfileModel.sub_agent.is_(True))
            .order_by(AgentProfileModel.name, AgentProfileModel.id),
        )
        definitions = []
        for row in rows:
            profile = await _with_assignment_summaries(
                AgentProfile.model_validate(row),
                user_id=user_id,
                session=session,
            )
            definitions.append(await _sub_definition(profile, session))
        return definitions


async def save_sub_agent(
    user_id: str,
    payload: SubAgentCreate,
    agent_id: uuid.UUID | None = None,
    session: AsyncSession | None = None,
) -> SubAgentDefinition:
    async with get_async_db_session(session) as session:
        await _validate_configuration(payload, session)
        if agent_id is None:
            row = AgentProfileModel(user_id=user_id, sub_agent=True)
            session.add(row)
        else:
            profile = await get_agent_profile(user_id, agent_id, session)
            if not profile.sub_agent:
                raise BadDataException("Main configuration cannot become a sub-agent")
            row = await session.get(AgentProfileModel, agent_id)
            assert row is not None
        if agent_id is not None:
            row.config_revision = AgentProfileModel.config_revision + 1
        for key, value in payload.model_dump().items():
            setattr(row, key, value)
        row.chat_parameters = cast(ChatCompletionParams, payload.chat_parameters.model_dump(exclude_none=True))
        await session.commit()
        await session.refresh(row)
        return await _sub_definition(await get_agent_profile(user_id, row.id, session), session)


async def delete_agent_profile(
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> SubAgentDefinition:
    async with get_async_db_session(session) as session:
        profile = await get_agent_profile(user_id, agent_id, session)
        if not profile.sub_agent:
            raise BadDataException("The main configuration cannot be deleted")
        row = await session.get(AgentProfileModel, agent_id)
        assert row is not None
        definition = await _sub_definition(profile, session)
        await session.delete(row)
        await session.commit()
        return definition


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
