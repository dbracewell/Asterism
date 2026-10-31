"""US-50.1: chat titles fall back to the owner's ChatGPT plan only without a usable draft model."""

import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import Chat, ChatInfo, Message, MessageStatus
from asterism.domains.chat.title_model import PlanTitleModel, resolve_title_model
from asterism.domains.chatgpt import plan_client
from asterism.domains.llm import client as llm_client
from asterism.domains.llm import draft
from asterism.domains.llm.draft import DraftModel
from asterism.domains.settings import service as settings_service
from openai import AsyncOpenAI
from test_chatgpt_connection import chatgpt as _chatgpt
from test_chatgpt_connection import connect, enable
from test_chatgpt_plan_models import plan_model_id
from test_chatgpt_plan_usage import COMPLETED, api_error, stream, text
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
chatgpt = _chatgpt
GLOBAL_A = uuid.UUID(int=1)


class TitleResponses:
    def __init__(self):
        self.requests: list[tuple[str, str]] = []
        self.replies: list[httpx.Response] = []

    def handle(self, request):
        self.requests.append((request.headers["authorization"], json.loads(request.content)["model"]))
        return self.replies.pop(0) if self.replies else stream(text("Spring garden plan"), COMPLETED)


@pytest.fixture
def titles(chatgpt, monkeypatch):
    client, sessions, double = chatgpt
    responses = TitleResponses()
    sdk = AsyncOpenAI(
        api_key="chatgpt-plan",
        base_url="https://api.openai.com/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(responses.handle)),
    )
    monkeypatch.setitem(llm_client._shared_openai_clients, ("https://api.openai.com/v1", "chatgpt-plan"), sdk)
    monkeypatch.setattr(plan_client, "RETRY_DELAYS", (0.0, 0.0, 0.0))
    monkeypatch.setattr(draft, "_draft_model", None)

    @asynccontextmanager
    async def session_context(session=None):
        async with sessions() as new_session:
            yield new_session

    monkeypatch.setattr("asterism.domains.chat.title_model.get_async_db_session", session_context)
    return client, sessions, double, responses


async def title_for(user_id: str, selected_model_id: uuid.UUID | None, monkeypatch) -> list[str]:
    chat = Chat(
        info=ChatInfo(
            id=uuid.uuid4(), user_id=user_id, created_at=1, updated_at=1, selected_model_id=selected_model_id
        ),
        messages=[
            Message(
                id=uuid.uuid4(),
                role="user",
                content="Help me plan my garden for spring",
                status=MessageStatus.PENDING,
                created_at=1,
            ),
        ],
    )
    orchestrator = ChatOrchestrator(SimpleNamespace(session=chat, model_id=selected_model_id))  # type: ignore[arg-type]
    saved: list[str] = []

    async def save(title: str):
        saved.append(title)

    monkeypatch.setattr(orchestrator, "_save_chat_title", save)
    await orchestrator.generate_chat_title()
    return saved


@pytest.mark.asyncio
async def test_without_a_draft_model_titles_run_on_the_owners_selected_plan_model(titles, monkeypatch):
    client, sessions, double, responses = titles
    await enable(client)
    double.models = [
        {"slug": "gpt-plan", "display_name": "GPT Plan", "visibility": "list"},
        {"slug": "gpt-alpha", "display_name": "Alpha", "visibility": "list"},
    ]
    await connect(client, double)
    selected = uuid.UUID(await plan_model_id(sessions, slug="gpt-plan"))

    assert await title_for("a", selected, monkeypatch) == ["Spring garden plan"]
    assert responses.requests == [("Bearer access-1", "gpt-plan")]

    # A chat on an admin model uses the owner's first available plan model.
    assert await title_for("a", GLOBAL_A, monkeypatch) == ["Spring garden plan"]
    assert responses.requests[-1] == ("Bearer access-1", "gpt-alpha")


@pytest.mark.asyncio
async def test_a_usable_draft_model_always_wins(titles):
    client, sessions, double, responses = titles
    await enable(client)
    await connect(client, double)
    async with sessions() as session:
        await settings_service.upsert_app_setting("draft_model_id", str(GLOBAL_A), session=session)

    model = await resolve_title_model("a", uuid.UUID(await plan_model_id(sessions)))

    assert isinstance(model, DraftModel)
    assert responses.requests == []


@pytest.mark.asyncio
async def test_never_uses_another_users_plan(titles, monkeypatch):
    client, sessions, double, responses = titles
    await enable(client)
    await connect(client, double)
    foreign = uuid.UUID(await plan_model_id(sessions))

    assert await resolve_title_model("b", foreign) is None
    assert await title_for("b", foreign, monkeypatch) == ["Help me plan my garden for spring"]
    assert responses.requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["policy_disabled", "paused", "disconnected"])
async def test_an_unavailable_plan_keeps_the_text_fallback(titles, monkeypatch, state):
    client, sessions, double, responses = titles
    await enable(client)
    await connect(client, double)
    selected = uuid.UUID(await plan_model_id(sessions))
    if state == "policy_disabled":
        await enable(client, False)
    elif state == "paused":
        responses.replies.append(api_error(429, "subscription_sharing_usage_limit_exceeded"))
        assert await title_for("a", selected, monkeypatch) == ["Help me plan my garden for spring"]
        assert (await client.get("/chatgpt/connection", headers=auth("a"))).json()["usage_paused"] is True
        responses.requests.clear()
    else:
        await client.post("/chatgpt/connection/disconnect", headers=auth("a"), json={})

    assert await resolve_title_model("a", selected) is None
    assert await title_for("a", selected, monkeypatch) == ["Help me plan my garden for spring"]
    assert responses.requests == []


@pytest.mark.asyncio
async def test_resolver_returns_a_plan_title_model_only_for_the_owner(titles):
    client, sessions, double, _ = titles
    await enable(client)
    await connect(client, double)

    model = await resolve_title_model("a", None)

    assert isinstance(model, PlanTitleModel)
