import pytest
import pytest_asyncio
from asterism.core.exceptions import BadDataException, UnauthorizedException
from asterism.db.base import Base
from asterism.db.schema_migrations import run_schema_migrations
from asterism.domains.agent.schemas import PartialAgentProfile
from asterism.domains.agent.service import (
    delete_agent_profile,
    upsert_agent_profile,
)
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.schemas import NewChatRequest
from asterism.domains.chat.service import create_chat, get_one
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import upsert_user_setting
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def chat_agent_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'chats.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all(
            [
                UserModel(id="user-a"),
                UserModel(id="user-b"),
                ApplicationSettingsModel(key="active_tools", value=["sub_agent"]),
            ]
        )
        await session.commit()
        yield session
    await engine.dispose()


def profile(name: str, *, sub_agent: bool = False) -> PartialAgentProfile:
    return PartialAgentProfile(
        name=name,
        description="test agent",
        sub_agent=sub_agent,
        model_id=None,
        system_prompt=None,
        max_steps=5,
        tools=[],
    )


@pytest.mark.asyncio
async def test_chat_binds_default_or_explicit_owned_main_agent(chat_agent_session):
    default = await upsert_agent_profile(
        "user-a", profile("Default"), chat_agent_session
    )
    override = await upsert_agent_profile(
        "user-a", profile("Override"), chat_agent_session
    )
    await upsert_user_setting(
        "user-a", "default_agent_id", str(default.id), chat_agent_session
    )

    default_chat = await create_chat(
        "user-a", NewChatRequest(user_prompt="Default"), chat_agent_session
    )
    override_chat = await create_chat(
        "user-a",
        NewChatRequest(user_prompt="Override", agent_id=override.id),
        chat_agent_session,
    )

    assert default_chat.info.agent_id == default.id
    assert override_chat.info.agent_id == override.id

    await upsert_user_setting(
        "user-a", "default_agent_id", str(override.id), chat_agent_session
    )
    persisted_default_chat = await get_one(
        default_chat.info.id, "user-a", chat_agent_session
    )
    assert persisted_default_chat.info.agent_id == default.id

    with pytest.raises(BadDataException, match="assigned to an existing chat"):
        await delete_agent_profile("user-a", override.id, chat_agent_session)


@pytest.mark.asyncio
async def test_chat_rejects_sub_agents_and_other_users_agents(chat_agent_session):
    main = await upsert_agent_profile("user-a", profile("Main"), chat_agent_session)
    sub = await upsert_agent_profile(
        "user-a", profile("Worker", sub_agent=True), chat_agent_session
    )
    other = await upsert_agent_profile("user-b", profile("Other"), chat_agent_session)
    await upsert_user_setting(
        "user-a", "default_agent_id", str(main.id), chat_agent_session
    )

    with pytest.raises(BadDataException, match="main agent"):
        await create_chat(
            "user-a",
            NewChatRequest(user_prompt="Delegate", agent_id=sub.id),
            chat_agent_session,
        )
    with pytest.raises(UnauthorizedException):
        await create_chat(
            "user-a",
            NewChatRequest(user_prompt="Foreign", agent_id=other.id),
            chat_agent_session,
        )


@pytest.mark.asyncio
async def test_chat_agent_migration_backfills_a_valid_main_default(
    chat_agent_session,
):
    main = await upsert_agent_profile("user-a", profile("Main"), chat_agent_session)
    await upsert_user_setting(
        "user-a", "default_agent_id", str(main.id), chat_agent_session
    )
    legacy_chat = ChatModel(user_id="user-a", agent_id=None)
    chat_agent_session.add(legacy_chat)
    await chat_agent_session.commit()

    async with chat_agent_session.bind.begin() as connection:  # type: ignore[union-attr]
        await run_schema_migrations(connection)
    await chat_agent_session.refresh(legacy_chat)

    assert legacy_chat.agent_id == main.id
