import uuid
from typing import cast

from sqlalchemy import select, text, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import (
    BadDataException,
    CodedException,
    NotFoundException,
    UnauthorizedException,
)
from asterism.db.database import get_async_db_session
from asterism.db.queries import paginate_select
from asterism.domains.courses.locks import managing_class, require_not_course_managed
from asterism.domains.llm.schemas import ChatCompletionParams
from asterism.domains.settings.models import LLMModel
from asterism.domains.tools.catalog import INTERNAL_TOOL_NAMES, configurable_tools
from asterism.domains.user.models import UserModel

from .models import AgentProfileModel, SubAgentTraceModel
from .queries import select_owned_agent_profiles
from .schemas import (
    AgentProfile,
    MainAgentConfiguration,
    MainAgentUpdate,
    SubAgentCreate,
    SubAgentDefinition,
    SubAgentInstructionsUpdate,
    SubAgentList,
    SubAgentTrace,
    SubAgentTraceCreate,
)


async def _ensure_valid_tools(
    profile: AgentProfile,
    session: AsyncSession | None = None,
) -> AgentProfile:
    from asterism.domains.settings.tool_settings import get_tool_settings

    app_settings = await get_tool_settings(session=session)
    if profile.tools:
        profile.tools = [t for t in profile.tools if t in app_settings.active_tools]
        profile.tools = configurable_tools(profile.tools)
    return profile


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
        return profile


async def provision_main_agent(user_id: str, session: AsyncSession) -> bool:
    """Idempotent provisioning inside the user's transaction, protected by a unique index."""
    existing = await session.scalar(
        select(AgentProfileModel.id).where(
            AgentProfileModel.user_id == user_id,
            AgentProfileModel.sub_agent.is_(False),
        ),
    )
    if existing is not None:
        return False
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
    return True


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
        result.tools = configurable_tools(result.tools)
        return result


async def _validate_configuration(user_id: str, payload: MainAgentUpdate, session: AsyncSession) -> None:
    from asterism.domains.settings.tool_settings import user_active_tools
    from asterism.domains.tools.registry import tool_registry

    if set(payload.tools) & INTERNAL_TOOL_NAMES:
        raise BadDataException("Internal tools are managed by context and cannot be configured")
    invalid = set(payload.tools) - (await user_active_tools(user_id, session) & set(tool_registry.registry))
    if invalid:
        raise BadDataException(f"Unavailable tools: {', '.join(sorted(invalid))}")
    if len(payload.tools) != len(set(payload.tools)):
        raise BadDataException("Tools must be unique")
    if isinstance(payload, SubAgentCreate):
        from asterism.domains.chatgpt.availability import available_user_model

        if await available_user_model(user_id, payload.model_id, session) is None:
            raise BadDataException("Sub-agent model must be available and active")


async def update_main_agent(
    user_id: str,
    payload: MainAgentUpdate,
    session: AsyncSession | None = None,
) -> MainAgentConfiguration:
    async with get_async_db_session(session) as session:
        await _validate_configuration(user_id, payload, session)
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


async def _sub_definition(user_id: str, profile: AgentProfile, session: AsyncSession) -> SubAgentDefinition:
    from asterism.domains.chatgpt.availability import ModelAvailability
    from asterism.domains.settings.queries import select_visible_models

    model = await session.scalar(select_visible_models(user_id).where(LLMModel.id == profile.model_id))
    reason = (
        (await ModelAvailability.load(user_id, session)).reason(model)
        if model is not None
        else "Model was removed; choose another model"
    )
    return SubAgentDefinition.model_validate(
        {
            **profile.model_dump(exclude={"sub_agent"}),
            "model_available": reason is None,
            "model_unavailable_reason": reason,
            "managed_by_class": await managing_class(user_id, [profile.id], session),
        },
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
            profile = AgentProfile.model_validate(row)
            definitions.append(await _sub_definition(user_id, profile, session))
        return definitions


async def list_sub_agents(
    user_id: str,
    session: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 10,
) -> SubAgentList:
    result = await paginate_select(
        statement=select_owned_agent_profiles(user_id)
        .where(AgentProfileModel.sub_agent.is_(True))
        .order_by(AgentProfileModel.name, AgentProfileModel.id),
        session=session,
        page=page,
        page_size=page_size,
    )
    items = [await _sub_definition(user_id, AgentProfile.model_validate(row), session) for row in result.records]
    return SubAgentList(items=items, total=result.total, page=page, page_size=page_size)


def _apply_definition(row: AgentProfileModel, payload: SubAgentCreate) -> None:
    for key, value in payload.model_dump().items():
        setattr(row, key, value)
    row.chat_parameters = cast(ChatCompletionParams, payload.chat_parameters.model_dump(exclude_none=True))


async def new_sub_agent(user_id: str, payload: SubAgentCreate, session: AsyncSession) -> AgentProfileModel:
    """A validated, unsaved row, so a larger transaction can add it."""
    await _validate_configuration(user_id, payload, session)
    row = AgentProfileModel(user_id=user_id, sub_agent=True)
    _apply_definition(row, payload)
    return row


async def replace_sub_agent(
    user_id: str, row: AgentProfileModel, payload: SubAgentCreate, session: AsyncSession
) -> None:
    """Validate and apply a whole definition to an owned row; no commit.

    For a larger transaction that updates a definition in place (US-60.3).
    """
    if row.user_id != user_id or not row.sub_agent:
        raise NotFoundException("Sub-agent not found")
    await _validate_configuration(user_id, payload, session)
    _apply_definition(row, payload)
    row.config_revision = AgentProfileModel.config_revision + 1


async def save_sub_agent(
    user_id: str,
    payload: SubAgentCreate,
    agent_id: uuid.UUID | None = None,
    session: AsyncSession | None = None,
) -> SubAgentDefinition:
    async with get_async_db_session(session) as session:
        await _validate_configuration(user_id, payload, session)
        if agent_id is None:
            row = AgentProfileModel(user_id=user_id, sub_agent=True)
            session.add(row)
        else:
            profile = await get_agent_profile(user_id, agent_id, session)
            if not profile.sub_agent:
                raise BadDataException("Main configuration cannot become a sub-agent")
            await require_not_course_managed(user_id=user_id, record_ids=[agent_id], session=session)
            row = await session.get(AgentProfileModel, agent_id)
            assert row is not None
        if agent_id is not None:
            row.config_revision = AgentProfileModel.config_revision + 1
        _apply_definition(row, payload)
        await session.commit()
        await session.refresh(row)
        return await _sub_definition(user_id, await get_agent_profile(user_id, row.id, session), session)


async def save_sub_agent_instructions(
    user_id: str,
    agent_id: uuid.UUID,
    payload: SubAgentInstructionsUpdate,
    session: AsyncSession | None = None,
) -> SubAgentDefinition:
    """Replace only a definition's instructions, if it is still at ``expected_revision``."""
    async with get_async_db_session(session) as session:
        await require_not_course_managed(user_id=user_id, record_ids=[agent_id], session=session)
        row = await session.scalar(
            update(AgentProfileModel)
            .where(
                AgentProfileModel.id == agent_id,
                AgentProfileModel.user_id == user_id,
                AgentProfileModel.sub_agent.is_(True),
                AgentProfileModel.config_revision == payload.expected_revision,
            )
            .values(system_prompt=payload.system_prompt, config_revision=AgentProfileModel.config_revision + 1)
            .returning(AgentProfileModel.id),
        )
        if row is None:
            owned = await session.scalar(
                select_owned_agent_profiles(user_id)
                .with_only_columns(AgentProfileModel.id)
                .where(AgentProfileModel.id == agent_id, AgentProfileModel.sub_agent.is_(True)),
            )
            if owned is None:
                raise NotFoundException("Sub-agent not found")
            raise CodedException(409, "The sub-agent changed since you opened it; reload and try again")
        await session.commit()
        return await _sub_definition(user_id, await get_agent_profile(user_id, agent_id, session), session)


async def delete_agent_profile(
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> SubAgentDefinition:
    async with get_async_db_session(session) as session:
        profile = await get_agent_profile(user_id, agent_id, session)
        if not profile.sub_agent:
            raise BadDataException("The main configuration cannot be deleted")
        await require_not_course_managed(user_id=user_id, record_ids=[agent_id], session=session)
        row = await session.get(AgentProfileModel, agent_id)
        assert row is not None
        definition = await _sub_definition(user_id, profile, session)
        from asterism.domains.projects.revocation import revoke_agent_projects

        await revoke_agent_projects(user_id=user_id, agent_id=agent_id, session=session)
        await session.delete(row)
        await session.commit()
        return definition


async def create_sub_agent_trace(
    trace: SubAgentTraceCreate,
    session: AsyncSession | None = None,
) -> SubAgentTrace:
    async with get_async_db_session(session) as session:
        model = SubAgentTraceModel(
            context_provenance=trace.context_provenance,
            prompt_provenance=trace.prompt_provenance,
            user_id=trace.user_id,
            parent_message_id=trace.parent_message_id,
            sub_agent_id=trace.sub_agent_id,
            sub_agent_name=trace.sub_agent_name,
            task_digest=trace.task_digest,
            caller_context_digest=trace.caller_context_digest,
            message_roles=trace.message_roles,
            result_digest=trace.result_digest,
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
