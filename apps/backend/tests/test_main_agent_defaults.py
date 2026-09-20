import pytest
import pytest_asyncio
from asterism.core.exceptions import BadDataException
from asterism.db.base import Base
from asterism.domains.agent.schemas import PartialAgentProfile
from asterism.domains.agent.service import delete_agent_profile, upsert_agent_profile
from asterism.domains.settings.models import ApplicationSettingsModel
from asterism.domains.settings.service import (
    get_user_settings,
    upsert_user_setting,
)
from asterism.domains.user.models import UserModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def main_agent_session(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'agents.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add_all(
            [
                UserModel(id="user-a"),
                UserModel(id="user-b"),
                ApplicationSettingsModel(key="active_tools", value=[]),
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
async def test_default_must_be_an_owned_main_agent(main_agent_session):
    main = await upsert_agent_profile("user-a", profile("Main"), main_agent_session)
    assert main.tools == ["sub_agent"]
    sub = await upsert_agent_profile(
        "user-a", profile("Worker", sub_agent=True), main_agent_session
    )
    other = await upsert_agent_profile("user-b", profile("Other"), main_agent_session)

    await upsert_user_setting(
        "user-a", "default_agent_id", str(main.id), main_agent_session
    )
    settings = await get_user_settings("user-a", main_agent_session)
    assert settings.default_agent_id == main.id

    with pytest.raises(BadDataException, match="sub-agent"):
        await upsert_user_setting(
            "user-a", "default_agent_id", str(sub.id), main_agent_session
        )
    with pytest.raises(BadDataException, match="main agent UUID"):
        await upsert_user_setting(
            "user-a", "default_agent_id", "not-a-uuid", main_agent_session
        )
    with pytest.raises(BadDataException):
        await upsert_user_setting(
            "user-a", "default_agent_id", str(other.id), main_agent_session
        )


@pytest.mark.asyncio
async def test_main_agent_delete_and_conversion_preserve_default(main_agent_session):
    default = await upsert_agent_profile(
        "user-a", profile("Default"), main_agent_session
    )
    other = await upsert_agent_profile("user-a", profile("Other"), main_agent_session)
    await upsert_user_setting(
        "user-a", "default_agent_id", str(default.id), main_agent_session
    )

    with pytest.raises(BadDataException, match="Select another default"):
        await delete_agent_profile("user-a", default.id, main_agent_session)

    with pytest.raises(BadDataException, match="Select another default"):
        await upsert_agent_profile(
            "user-a",
            profile("Default", sub_agent=True).model_copy(update={"id": default.id}),
            main_agent_session,
        )

    await delete_agent_profile("user-a", other.id, main_agent_session)
    with pytest.raises(BadDataException, match="at least one main"):
        await delete_agent_profile("user-a", default.id, main_agent_session)
