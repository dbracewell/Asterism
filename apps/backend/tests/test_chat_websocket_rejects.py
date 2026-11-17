"""US-77.5: the chat WebSocket rejects unknown and foreign chats cleanly before accept."""

import uuid
from contextlib import asynccontextmanager

import pytest
from asterism.core.exceptions import ForbiddenException
from asterism.core.schemas import AuthedUser
from asterism.domains.chat import router
from asterism.domains.chat.jobs import chat_jobs
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


class Socket:
    def __init__(self):
        self.accepted = False
        self.closed: tuple[int, str] | None = None

    async def accept(self):
        self.accepted = True

    async def close(self, code=1000, reason=None):
        self.closed = (code, reason or "")


@pytest.fixture
def stream(project_api, monkeypatch):
    client, sessions, _ = project_api

    @asynccontextmanager
    async def session():
        async with sessions() as db:
            yield db

    monkeypatch.setattr(router.db_session_manager, "session", session)
    monkeypatch.setattr(
        router, "verify_jwks_token", lambda token: AuthedUser(id=token, email="x@x.test", name=token, role="user")
    )

    async def connect(chat_id, user="a") -> Socket:
        socket = Socket()
        admitted = chat_jobs.controller_count
        await router.chat(websocket=socket, chat_id=chat_id, token=user)  # type: ignore[arg-type]
        # The admission reserved before the lookup is always released.
        assert chat_jobs.controller_count == admitted
        return socket

    return client, connect


async def own_chat(client) -> uuid.UUID:
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": str(uuid.UUID(int=1))},
    )
    assert response.status_code == 200, response.text
    return uuid.UUID(response.json()["info"]["id"])


@pytest.mark.asyncio
async def test_an_unknown_chat_closes_with_a_reason_before_accept(stream):
    _, connect = stream
    socket = await connect(uuid.uuid4())
    assert socket.closed == (1008, "Chat not found") and not socket.accepted


@pytest.mark.asyncio
async def test_another_users_chat_reads_as_not_found(stream):
    client, connect = stream
    socket = await connect(await own_chat(client), user="b")
    assert socket.closed == (1008, "Chat not found") and not socket.accepted


@pytest.mark.asyncio
async def test_a_forbidden_agent_lookup_closes_as_forbidden(stream, monkeypatch):
    client, connect = stream
    chat_id = await own_chat(client)

    async def forbidden(**_kwargs):
        raise ForbiddenException()

    monkeypatch.setattr(router.agent_service, "get_agent_profile", forbidden)
    socket = await connect(chat_id)
    assert socket.closed == (1008, "Forbidden") and not socket.accepted
