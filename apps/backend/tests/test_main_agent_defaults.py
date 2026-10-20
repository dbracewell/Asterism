"""Singleton main configuration and fixed-model worker policy."""

import asyncio
import uuid

import pytest
import pytest_asyncio
from asterism.core.exceptions import BadDataException, UnauthorizedException
from asterism.db.model_registry import Base
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.agent.schemas import GenerationDefaults, MainAgentUpdate, SubAgentCreate
from asterism.domains.agent.service import (
    delete_agent_profile,
    get_main_agent,
    get_main_agent_profile,
    get_sub_agents,
    list_sub_agents,
    save_sub_agent,
    update_main_agent,
)
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, ProviderModel
from asterism.domains.settings.schemas import ProviderSettings
from asterism.domains.settings.service import (
    bulk_upsert_user_settings,
    get_user_settings,
    update_provider_settings,
    upsert_user_setting,
)
from asterism.domains.user.service import create_user, delete_user, ensure_user
from pydantic import ValidationError
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def main_agent_session(tmp_path):
    import asterism.domains.tools.builtin.web_fetch  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'agents.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        await create_user("user-a", session)
        await create_user("user-b", session)
        session.add(ApplicationSettingsModel(key="active_tools", value=["web_fetch"]))
        provider = ProviderModel(name="Test", base_url="http://localhost/v1", api_key="test")
        session.add(provider)
        await session.flush()
        model = LLMModel(name="Worker model", provider_id=provider.id, is_active=True)
        session.add(model)
        await session.commit()
        session.info["sessions"] = sessions
        session.info["model"] = model
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_provision_without_models_and_concurrent_creation(main_agent_session):
    session = main_agent_session
    main = await get_main_agent_profile("user-a", session)
    assert main.model_id is None
    assert main.tools == []
    assert (await get_user_settings("user-a", session)).default_model_id is None

    async def create():
        async with session.info["sessions"]() as other:
            return await create_user("race", other)

    assert sorted(await asyncio.gather(create(), create())) == [False, True]
    for _ in range(2):
        await ensure_user("race", session)
    assert (
        await session.scalar(
            select(func.count())
            .select_from(AgentProfileModel)
            .where(
                AgentProfileModel.user_id == "race",
                AgentProfileModel.sub_agent.is_(False),
            ),
        )
        == 1
    )
    await delete_user("race", session)
    assert not list(await session.scalars(select(AgentProfileModel).where(AgentProfileModel.user_id == "race")))


@pytest.mark.asyncio
async def test_database_unique_role_and_model_constraints(main_agent_session):
    session = main_agent_session
    for fields in [
        dict(sub_agent=False, model_id=None),
        dict(sub_agent=False, model_id=session.info["model"].id),
        dict(sub_agent=True, model_id=None),
    ]:
        session.add(AgentProfileModel(user_id="user-a", name="Bad", description="", **fields))
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


@pytest.mark.asyncio
async def test_main_update_is_model_free_owner_scoped_and_cannot_delete(main_agent_session):
    session = main_agent_session
    before = await get_main_agent("user-a", session)
    updated = await update_main_agent(
        "user-a",
        MainAgentUpdate(
            system_prompt="Be precise",
            max_steps=7,
            tools=["web_fetch"],
            chat_parameters=GenerationDefaults(temperature=0.2),
        ),
        session,
    )
    assert updated.id == before.id
    assert updated.system_prompt == "Be precise"
    assert updated.chat_parameters.temperature == 0.2
    assert (await get_main_agent("user-b", session)).system_prompt == ""
    with pytest.raises(BadDataException, match="cannot be deleted"):
        await delete_agent_profile("user-a", before.id, session)
    with pytest.raises(UnauthorizedException):
        await delete_agent_profile("user-b", before.id, session)
    with pytest.raises(ValidationError):
        MainAgentUpdate(model_id=uuid.uuid4())
    with pytest.raises(BadDataException):
        await upsert_user_setting("user-a", "default_agent_id", str(before.id), session)


@pytest.mark.asyncio
async def test_sub_agents_fixed_binding_isolation_and_unavailable_model(main_agent_session):
    session = main_agent_session
    model = session.info["model"]
    assert await get_sub_agents("user-a", session) == []
    payload = SubAgentCreate(name="Research", description="Facts", model_id=model.id, system_prompt="Research")
    worker = await save_sub_agent("user-a", payload, session=session)
    assert worker.model_id == model.id and worker.model_available
    assert await get_sub_agents("user-b", session) == []
    with pytest.raises(UnauthorizedException):
        await save_sub_agent("user-b", payload, worker.id, session)
    main = await get_main_agent("user-a", session)
    with pytest.raises(BadDataException):
        await save_sub_agent("user-a", payload, main.id, session)
    with pytest.raises(BadDataException, match="Rebind or delete"):
        await update_provider_settings(ProviderSettings(llm_providers=[]), session)
    await session.rollback()
    # IDs survive disablement and the API makes availability explicit.
    model = await session.get(LLMModel, worker.model_id)
    model.is_active = False
    await session.commit()
    settings = await get_user_settings("user-a", session)
    assert settings.sub_agents[worker.id].model_id == worker.model_id
    assert settings.sub_agents[worker.id].model_available is False
    with pytest.raises(BadDataException):
        await save_sub_agent("user-a", payload, worker.id, session)
    with pytest.raises(IntegrityError):
        await session.delete(model)
        await session.commit()
    await session.rollback()
    await delete_agent_profile("user-a", worker.id, session)
    assert await get_sub_agents("user-a", session) == []


@pytest.mark.asyncio
async def test_invalid_capabilities_models_and_settings_batch_are_atomic(main_agent_session):
    session = main_agent_session
    with pytest.raises(BadDataException):
        await update_main_agent("user-a", MainAgentUpdate(tools=["unknown"]), session)
    with pytest.raises(BadDataException):
        await save_sub_agent("user-a", SubAgentCreate(name="Bad", model_id=uuid.uuid4()), session=session)
    with pytest.raises(BadDataException):
        await bulk_upsert_user_settings("user-a", {"theme": "dark", "default_agent_id": str(uuid.uuid4())}, session)
    assert (await get_user_settings("user-a", session)).theme == "light"
    for fields in [
        dict(max_steps=0),
        dict(chat_parameters={"extra_body": {"model": "override"}}),
        dict(chat_parameters={"temperature": 3}),
    ]:
        with pytest.raises(ValidationError):
            MainAgentUpdate(**fields)


@pytest.mark.asyncio
async def test_runtime_refreshes_main_behavior_separate_from_model_and_rechecks_cached_model(
    main_agent_session,
    monkeypatch,
):
    from contextlib import asynccontextmanager

    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.chat.schemas import Chat, ChatInfo

    session = main_agent_session
    profile = await get_main_agent_profile("user-a", session)
    model = session.info["model"]
    runtime = Agent(
        profile=profile,
        user=AuthedUser(id="user-a", name="A", email="a@example.test", role="user"),
        session=Chat(
            info=ChatInfo(
                id=uuid.uuid4(),
                user_id="user-a",
                agent_id=profile.id,
                selected_model_id=model.id,
                created_at=0,
                updated_at=0,
            ),
            messages=[],
        ),
        model_id=model.id,
    )

    @asynccontextmanager
    async def db(supplied=None):
        yield session

    monkeypatch.setattr("asterism.domains.agent.service.get_async_db_session", db)
    monkeypatch.setattr("asterism.domains.settings.service.get_async_db_session", db)
    await update_main_agent("user-a", MainAgentUpdate(system_prompt="Updated", max_steps=9), session)
    await upsert_user_setting("user-a", "default_model_id", str(model.id), session)
    await runtime.refresh_main_configuration()
    assert runtime.profile.system_prompt == "Updated"
    assert runtime.max_steps == 9
    assert runtime.profile.model_id is None and runtime.model_id == model.id
    marker = object()
    runtime._client = marker  # type: ignore[assignment]
    assert await runtime._get_client() is marker
    model.is_active = False
    await session.commit()
    with pytest.raises(BadDataException, match="unavailable"):
        await runtime._get_client()


@pytest.mark.asyncio
async def test_unknown_even_enabled_tool_is_rejected_and_no_sub_agent_count_limit(main_agent_session):
    session = main_agent_session
    active = await session.get(ApplicationSettingsModel, "active_tools")
    active.value = ["not_registered"]
    await session.commit()
    with pytest.raises(BadDataException):
        await update_main_agent("user-a", MainAgentUpdate(tools=["not_registered"]), session)
    for index in range(21):
        await save_sub_agent(
            "user-a",
            SubAgentCreate(name=f"Worker {index}", model_id=session.info["model"].id),
            session=session,
        )
    assert len(await get_sub_agents("user-a", session)) == 21
    assert (
        len(
            list(
                await session.scalars(
                    select(AgentProfileModel).where(
                        AgentProfileModel.user_id == "user-a",
                        AgentProfileModel.sub_agent.is_(False),
                    ),
                ),
            ),
        )
        == 1
    )


@pytest.mark.asyncio
async def test_sub_agent_pages_filter_owner_before_pagination(main_agent_session):
    session = main_agent_session
    model = session.info["model"]
    for owner, names in [("user-a", ["Zeta", "Alpha", "Alpha"]), ("user-b", ["Foreign"])]:
        for name in names:
            await save_sub_agent(owner, SubAgentCreate(name=name, model_id=model.id), session=session)
    first = await list_sub_agents("user-a", session, page=1, page_size=2)
    second = await list_sub_agents("user-a", session, page=2, page_size=2)
    assert first.total == second.total == 3
    assert [item.name for item in first.items] == ["Alpha", "Alpha"]
    assert [item.name for item in second.items] == ["Zeta"]
    assert first.items[0].id.int < first.items[1].id.int
    assert not set(item.id for item in first.items) & set(item.id for item in second.items)
    foreign = await list_sub_agents("user-b", session)
    assert foreign.total == 1 and foreign.items[0].name == "Foreign"
    model.is_active = False
    await session.commit()
    unavailable = await list_sub_agents("user-a", session)
    assert all(not item.model_available and item.model_id == model.id for item in unavailable.items)
    assert not (await list_sub_agents("user-a", session, page=4)).items
    with pytest.raises(BadDataException):
        await list_sub_agents("user-a", session, page=0)
