"""User lifecycle: tombstones, permanent deletion, storage cleanup, and API authz."""

import uuid
from contextlib import asynccontextmanager
from urllib.parse import quote

import httpx
import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.exceptions import ConflictException, NotFoundException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.db.database import set_sqlite_pragma
from asterism.db.dependencies import get_db_session
from asterism.db.model_registry import Base
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.files.store import LocalFileStore
from asterism.domains.user.models import DeletedUserModel, UserModel
from asterism.domains.user.service import (
    UserCreateOutcome,
    create_user,
    delete_user,
    ensure_user,
    list_users,
    user_exists,
)
from asterism.main import app
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


class FakeVectorStore:
    """Records per-user deletions instead of touching LanceDB."""

    def __init__(self):
        self.deleted_users: list[str] = []

    async def delete_user(self, *, user_id: str) -> None:
        self.deleted_users.append(user_id)


@pytest_asyncio.fixture
async def user_service_env(tmp_path, monkeypatch):
    """Isolated database plus a fake vector store for service-level tests."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'users.db'}")
    event.listen(engine.sync_engine, "connect", set_sqlite_pragma)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with sessions() as session:
                yield session

    monkeypatch.setattr("asterism.domains.user.service.get_async_db_session", session_context)
    vectors = FakeVectorStore()
    monkeypatch.setattr("asterism.domains.extraction.vector_store.vector_store", vectors)
    # files_root is a read-only property derived from storage_root.
    monkeypatch.setattr(config, "storage_root", tmp_path)

    yield sessions, vectors, tmp_path
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_provisions_and_reports_outcome(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as session:
        assert await create_user("a", session) is UserCreateOutcome.CREATED
        assert await user_exists("a", session)
        main_agents = list(
            await session.scalars(
                select(AgentProfileModel).where(
                    AgentProfileModel.user_id == "a",
                    AgentProfileModel.sub_agent.is_(False),
                )
            )
        )
        assert len(main_agents) == 1
        # A second attempt is a distinct result, not an error.
        assert await create_user("a", session) is UserCreateOutcome.ALREADY_EXISTS


@pytest.mark.asyncio
async def test_delete_is_permanent_and_cleans_storage(user_service_env):
    sessions, vectors, tmp_path = user_service_env
    store = LocalFileStore(tmp_path / "files")
    file_id = uuid.uuid4()
    store.save("a", file_id, ".txt", b"data")
    assert (tmp_path / "files" / quote("a")).exists()

    async with sessions() as session:
        await create_user("a", session)
        await delete_user("a", session)

        # Relational row gone, tombstone present.
        assert await session.get(UserModel, "a") is None
        assert await session.get(DeletedUserModel, "a") is not None
        assert not await user_exists("a", session)

    # Non-relational storage removed best-effort.
    assert not (tmp_path / "files" / quote("a")).exists()
    assert vectors.deleted_users == ["a"]

    # The id can never come back: creates conflict and JWTs are rejected.
    async with sessions() as session:
        with pytest.raises(ConflictException, match="deleted"):
            await create_user("a", session)
        with pytest.raises(UnauthorizedException, match="deleted"):
            await ensure_user("a", session)


@pytest.mark.asyncio
async def test_delete_missing_user_is_not_found(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as session:
        with pytest.raises(NotFoundException):
            await delete_user("ghost", session)


@pytest.mark.asyncio
async def test_list_users_is_sorted(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as session:
        await create_user("zeta", session)
        await create_user("alpha", session)
        assert await list_users(session) == ["alpha", "zeta"]


@pytest_asyncio.fixture
async def user_api(tmp_path, monkeypatch):
    """The real app against an isolated database with fake JWTs."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'users.db'}")
    event.listen(engine.sync_engine, "connect", set_sqlite_pragma)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with sessions() as session:
                yield session

    monkeypatch.setattr("asterism.domains.user.service.get_async_db_session", session_context)
    vectors = FakeVectorStore()
    monkeypatch.setattr("asterism.domains.extraction.vector_store.vector_store", vectors)
    # files_root is a read-only property derived from storage_root.
    monkeypatch.setattr(config, "storage_root", tmp_path)

    async def db():
        async with sessions() as session:
            yield session

    def verify_token(token):
        if token == "admin":
            return AuthedUser(id="admin", email="admin@example.test", name="Admin", role="admin")
        if token in ("a", "b"):
            return AuthedUser(id=token, email=f"{token}@example.test", name=token, role="user")
        raise UnauthorizedException()

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    app.dependency_overrides[get_db_session] = db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            yield client, vectors, tmp_path
    finally:
        app.dependency_overrides.pop(get_db_session, None)
        await engine.dispose()


def auth(user):
    return {"Authorization": f"Bearer {user}"}


@pytest.mark.asyncio
async def test_create_requires_admin_or_system_key(user_api, monkeypatch):
    client, _, _ = user_api
    monkeypatch.setattr(config, "system_key", "s3cret-key")

    # No credentials at all.
    assert (await client.post("/users/", json={"user_id": "a"})).status_code == 401
    # A wrong system key is rejected like no key.
    assert (await client.post("/users/", json={"user_id": "a", "system_key": "wrong"})).status_code == 401
    # A non-admin JWT without the key cannot create.
    assert (await client.post("/users/", json={"user_id": "a"}, headers=auth("a"))).status_code == 401
    # The system key alone works, and the body distinguishes created from existing.
    first = await client.post("/users/", json={"user_id": "a", "system_key": "s3cret-key"})
    assert first.status_code == 200 and first.json() is True
    second = await client.post("/users/", json={"user_id": "a", "system_key": "s3cret-key"})
    assert second.status_code == 200 and second.json() is False
    # An admin JWT works without the key.
    third = await client.post("/users/", json={"user_id": "b"}, headers=auth("admin"))
    assert third.status_code == 200 and third.json() is True


@pytest.mark.asyncio
async def test_create_rejects_tombstoned_ids(user_api, monkeypatch):
    client, _, _ = user_api
    monkeypatch.setattr(config, "system_key", "s3cret-key")
    assert (await client.post("/users/", json={"user_id": "a"}, headers=auth("admin"))).status_code == 200
    assert (await client.delete("/users/a", headers=auth("admin"))).status_code == 200
    # Neither the system key nor an admin can resurrect a deleted id.
    response = await client.post("/users/", json={"user_id": "a", "system_key": "s3cret-key"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_delete_requires_admin_and_never_self(user_api):
    client, _, _ = user_api
    # A non-admin cannot delete anyone.
    assert (await client.delete("/users/a", headers=auth("a"))).status_code == 401
    # An admin may not delete their own account.
    assert (await client.delete("/users/admin", headers=auth("admin"))).status_code == 403
    # Deleting an unknown user is a 404, not a silent success.
    assert (await client.delete("/users/ghost", headers=auth("admin"))).status_code == 404

    response = await client.delete("/users/a", headers=auth("admin"))
    assert response.status_code == 200 and response.json() is True
    # The id is gone for good.
    assert (await client.delete("/users/a", headers=auth("admin"))).status_code == 404


@pytest.mark.asyncio
async def test_deleted_users_are_rejected_on_their_next_request(user_api):
    client, _, _ = user_api
    # "a" authenticates fine while they exist (this also provisions them).
    assert (await client.get("/users/", headers=auth("a"))).status_code == 401  # non-admin: list is admin-only
    assert (await client.delete("/users/a", headers=auth("admin"))).status_code == 200
    # Their still-valid JWT now hits the tombstone instead of re-creating them.
    response = await client.get("/users/", headers=auth("a"))
    assert response.status_code == 401
    assert "deleted" in response.json()["detail"]


@pytest.mark.asyncio
async def test_list_users_is_admin_only_and_sorted(user_api):
    client, _, _ = user_api
    # Unauthenticated and non-admin callers are rejected.
    assert (await client.get("/users/")).status_code == 401
    assert (await client.get("/users/", headers=auth("a"))).status_code == 401

    for user_id in ("zeta", "alpha"):
        assert (await client.post("/users/", json={"user_id": user_id}, headers=auth("admin"))).status_code == 200
    response = await client.get("/users/", headers=auth("admin"))
    assert response.status_code == 200
    # "a" and "admin" are present because their first authenticated calls
    # (the 401 probes above) auto-provisioned them.
    assert response.json() == ["a", "admin", "alpha", "zeta"]
