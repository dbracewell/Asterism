"""US-86.2: suspension, admin guards and deletion requests."""

import uuid
from contextlib import asynccontextmanager

import pytest
from asterism.core.exceptions import ConflictException, ForbiddenException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.chat import router as chat_router
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.groups.models import ADMIN_GROUP
from asterism.domains.user import lifecycle
from asterism.domains.user.models import AccountDeletionRequestModel, UserModel
from test_user_lifecycle import auth, user_api, user_api_db  # noqa: F401 - fixtures

USERS = {
    "admin": "admin",
    "admin2": "admin",
    "a": "user",
    "b": "user",
}


@pytest.fixture
def accounts(user_api, user_api_db, monkeypatch):  # noqa: F811
    """The user API with a second admin, and the chat socket on the same database."""

    def verify_token(token):
        if token not in USERS:
            raise UnauthorizedException()
        return AuthedUser(id=token, email=f"{token}@example.test", name=token, role=USERS[token])

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    monkeypatch.setattr(chat_router, "verify_jwks_token", verify_token)

    @asynccontextmanager
    async def chat_session():
        async with user_api_db() as session:
            yield session

    monkeypatch.setattr(chat_router.db_session_manager, "session", chat_session)
    client, _, _ = user_api
    return client, user_api_db


async def provision(client, *users):
    for user in users:
        assert (await client.get("/users/me/deletion-request", headers=auth(user))).status_code == 200


@pytest.mark.asyncio
async def test_suspended_token_is_refused_until_reactivated(accounts):
    client, sessions = accounts
    await provision(client, "admin", "a")

    assert (await client.put("/users/a/suspension", headers=auth("admin"))).status_code == 200
    refused = await client.get("/users/me/deletion-request", headers=auth("a"))
    assert refused.status_code == 401
    assert "suspended" in refused.json()["detail"]
    # Idempotent, and data is kept.
    assert (await client.put("/users/a/suspension", headers=auth("admin"))).status_code == 200
    async with sessions() as session:
        assert (await session.get(UserModel, "a")).suspended_at is not None

    listed = (await client.get("/users/", headers=auth("admin"))).json()["items"]
    assert {user["id"]: user["suspended"] for user in listed} == {"admin": False, "a": True}

    assert (await client.delete("/users/a/suspension", headers=auth("admin"))).status_code == 200
    assert (await client.get("/users/me/deletion-request", headers=auth("a"))).status_code == 200


@pytest.mark.asyncio
async def test_suspension_requires_admin_and_never_self(accounts):
    client, _ = accounts
    await provision(client, "admin", "admin2", "a", "b")

    assert (await client.put("/users/b/suspension", headers=auth("a"))).status_code == 401
    assert (await client.delete("/users/b/suspension", headers=auth("a"))).status_code == 401
    own = await client.put("/users/admin/suspension", headers=auth("admin"))
    assert own.status_code == 403 and "your own account" in own.json()["detail"]
    assert (await client.put("/users/ghost/suspension", headers=auth("admin"))).status_code == 404
    # Another administrator can be suspended while one stays active.
    assert (await client.put("/users/admin2/suspension", headers=auth("admin"))).status_code == 200
    assert (await client.get("/users/", headers=auth("admin2"))).status_code == 401


@pytest.mark.asyncio
async def test_last_administrator_cannot_be_suspended_or_deleted(accounts):
    client, sessions = accounts
    await provision(client, "admin", "admin2")
    async with sessions() as session:
        await session.execute(
            UserModel.__table__.update().where(UserModel.id == "admin2").values(suspended_at=1)  # pyright: ignore[reportAttributeAccessIssue]
        )
        await session.commit()
        target = await session.get(UserModel, "admin")
        assert target is not None and target.group_id == ADMIN_GROUP
        for action in ("suspend", "delete"):
            with pytest.raises(ConflictException, match="last administrator"):
                await lifecycle.check_admin_action("someone-else", target, action, session)
        with pytest.raises(ForbiddenException):
            await lifecycle.check_admin_action("admin", target, "delete", session)


@pytest.mark.asyncio
async def test_delete_refuses_self_and_removes_the_request(accounts):
    client, sessions = accounts
    await provision(client, "admin", "a")
    assert (await client.delete("/users/admin", headers=auth("admin"))).status_code == 403
    assert (await client.put("/users/me/deletion-request", headers=auth("a"))).status_code == 200
    assert (await client.delete("/users/a", headers=auth("admin"))).status_code == 200
    async with sessions() as session:
        assert await session.get(AccountDeletionRequestModel, "a") is None


@pytest.mark.asyncio
async def test_suspended_token_is_refused_on_the_chat_websocket(accounts):
    client, _ = accounts
    await provision(client, "admin", "a")
    assert (await client.put("/users/a/suspension", headers=auth("admin"))).status_code == 200

    class Socket:
        closed: tuple[int, str] | None = None

        async def close(self, code: int, reason: str) -> None:
            self.closed = (code, reason)

    socket = Socket()
    admitted = chat_jobs.controller_count
    await chat_router.chat(websocket=socket, chat_id=uuid.uuid4(), token="a")  # pyright: ignore[reportArgumentType]
    assert socket.closed == (1008, "Unauthorized")
    # Refused before accept, and the reserved admission is released.
    assert chat_jobs.controller_count == admitted


@pytest.mark.asyncio
async def test_deletion_request_lifecycle(accounts):
    client, sessions = accounts
    await provision(client, "admin", "a")

    assert (await client.get("/users/me/deletion-request", headers=auth("a"))).json() == {"requested_at": None}
    made = (await client.put("/users/me/deletion-request", headers=auth("a"))).json()["requested_at"]
    assert isinstance(made, int)
    # Asking again keeps the first time.
    assert (await client.put("/users/me/deletion-request", headers=auth("a"))).json()["requested_at"] == made

    listed = (await client.get("/users/", headers=auth("admin"))).json()["items"]
    assert {user["id"]: user["deletion_requested_at"] for user in listed} == {"admin": None, "a": made}

    # Withdraw, ask again, then an admin dismisses: nothing else changes.
    assert (await client.delete("/users/me/deletion-request", headers=auth("a"))).json() == {"requested_at": None}
    assert (await client.put("/users/me/deletion-request", headers=auth("a"))).status_code == 200
    assert (await client.delete("/users/a/deletion-request", headers=auth("b"))).status_code == 401
    assert (await client.delete("/users/a/deletion-request", headers=auth("admin"))).status_code == 200
    assert (await client.get("/users/me/deletion-request", headers=auth("a"))).json() == {"requested_at": None}
    async with sessions() as session:
        user = await session.get(UserModel, "a")
        assert user is not None and user.suspended_at is None


@pytest.mark.asyncio
async def test_administrators_cannot_request_deletion(accounts):
    client, _ = accounts
    response = await client.put("/users/me/deletion-request", headers=auth("admin"))
    assert response.status_code == 403
