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
    UserIdentity,
    clear_user_cache,
    create_user,
    delete_user,
    ensure_user,
    list_users,
    sync_identity,
    user_exists,
)
from asterism.main import app
from sqlalchemy import event, select, update
from sqlalchemy.exc import IntegrityError
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
    monkeypatch.setattr("asterism.domains.knowledge.vector_store.vector_store", vectors)
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
    monkeypatch.setattr("asterism.domains.knowledge.vector_store.vector_store", vectors)
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


# --- US-64.1: stored name and email -------------------------------------------------


@pytest_asyncio.fixture
async def user_api_db(user_api, tmp_path):
    """A second session factory on the database file behind ``user_api``."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'users.db'}")
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def count_user_updates(sessions) -> list[str]:
    """Record every UPDATE statement against ``users`` on this engine."""
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("UPDATE USERS"):
            statements.append(statement)

    event.listen(sessions.kw["bind"].sync_engine, "before_cursor_execute", record)
    return statements


async def stored_identity(sessions, user_id):
    async with sessions() as session:
        user = await session.get(UserModel, user_id)
        assert user is not None
        return user.name, user.email


@pytest.mark.asyncio
async def test_provisioning_stores_name_and_email(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as session:
        await create_user("a", session, UserIdentity.of(name="  Ada  ", email="ada@example.test"))
        # No identity known yet is allowed (an id-only admin create).
        await create_user("b", session)
        await ensure_user("c", session, UserIdentity.of(name="Cy", email="cy@example.test"))
    assert await stored_identity(sessions, "a") == ("Ada", "ada@example.test")
    assert await stored_identity(sessions, "b") == (None, None)
    assert await stored_identity(sessions, "c") == ("Cy", "cy@example.test")

    # Provisioning an existing row syncs it rather than ignoring the values.
    async with sessions() as session:
        outcome = await create_user("b", session, UserIdentity.of(name="Bea", email="bea@example.test"))
    assert outcome is UserCreateOutcome.ALREADY_EXISTS
    assert await stored_identity(sessions, "b") == ("Bea", "bea@example.test")


@pytest.mark.asyncio
async def test_sync_writes_only_when_claims_change(user_service_env):
    sessions, _, _ = user_service_env
    ada = UserIdentity.of(name="Ada", email="ada@example.test")
    async with sessions() as session:
        await create_user("a", session, ada)
    updates = count_user_updates(sessions)

    # Same claims: the cache answers, with no statement at all.
    assert await sync_identity("a", ada) is False
    assert updates == []
    # A cold cache reads the row and still writes nothing.
    clear_user_cache()
    assert await sync_identity("a", ada) is False
    assert await sync_identity("a", ada) is False
    assert updates == []

    # A rename is written once, then cached.
    renamed = UserIdentity.of(name="Ada L", email="ada@example.test")
    assert await sync_identity("a", renamed) is True
    assert await sync_identity("a", renamed) is False
    assert len(updates) == 1
    assert await stored_identity(sessions, "a") == ("Ada L", "ada@example.test")


@pytest.mark.asyncio
async def test_missing_or_blank_claims_never_blank_stored_values(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as session:
        await create_user("a", session, UserIdentity.of(name="Ada", email="ada@example.test"))

    assert await sync_identity("a", UserIdentity.of()) is False
    assert await sync_identity("a", UserIdentity.of(name="   ", email=None)) is False
    assert await sync_identity("a", UserIdentity.of(name=42, email="")) is False
    assert await stored_identity(sessions, "a") == ("Ada", "ada@example.test")

    # One known claim updates only its own column.
    assert await sync_identity("a", UserIdentity.of(email="new@example.test")) is True
    assert await stored_identity(sessions, "a") == ("Ada", "new@example.test")


@pytest.mark.asyncio
async def test_sync_for_a_missing_user_writes_nothing_and_caches_nothing(user_service_env):
    sessions, _, _ = user_service_env
    ghost = UserIdentity.of(name="Ghost", email="ghost@example.test")
    assert await sync_identity("ghost", ghost) is False
    async with sessions() as session:
        await create_user("ghost", session)
    # The earlier miss was not cached as "already in sync".
    assert await sync_identity("ghost", ghost) is True
    assert await stored_identity(sessions, "ghost") == ("Ghost", "ghost@example.test")


@pytest.mark.asyncio
async def test_identity_columns_reject_blank_values(user_service_env):
    sessions, _, _ = user_service_env
    async with sessions() as session:
        await create_user("a", session)
        with pytest.raises(IntegrityError):
            await session.execute(update(UserModel).where(UserModel.id == "a").values(name="  "))
        await session.rollback()


@pytest.mark.asyncio
async def test_a_renamed_token_updates_the_backend_copy(user_api, user_api_db, monkeypatch):
    client, _, _ = user_api
    claims = {"name": "Ada", "email": "ada@example.test"}

    def verify_token(token):
        if token != "ada":
            raise UnauthorizedException()
        return AuthedUser(id="ada", role="user", **claims)

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    # Any authenticated route provisions and syncs; this one is admin-only.
    assert (await client.get("/users/", headers=auth("ada"))).status_code == 401
    sessions = user_api_db
    assert await stored_identity(sessions, "ada") == ("Ada", "ada@example.test")

    claims.update(name="Ada Lovelace", email="lovelace@example.test")
    await client.get("/users/", headers=auth("ada"))
    assert await stored_identity(sessions, "ada") == ("Ada Lovelace", "lovelace@example.test")


@pytest.mark.asyncio
async def test_admin_and_system_key_creates_store_identity(user_api, user_api_db, monkeypatch):
    client, _, _ = user_api
    monkeypatch.setattr(config, "system_key", "s3cret-key")
    sessions = user_api_db
    body = {"user_id": "inst", "name": "Installer", "email": "inst@example.test", "system_key": "s3cret-key"}
    assert (await client.post("/users/", json=body)).json() is True
    assert await stored_identity(sessions, "inst") == ("Installer", "inst@example.test")

    body = {"user_id": "made", "name": "Made By Admin", "email": "made@example.test"}
    assert (await client.post("/users/", json=body, headers=auth("admin"))).json() is True
    assert await stored_identity(sessions, "made") == ("Made By Admin", "made@example.test")

    # Blank values are refused rather than stored.
    blank = {"user_id": "blank", "name": " ", "system_key": "s3cret-key"}
    assert (await client.post("/users/", json=blank)).status_code == 422
