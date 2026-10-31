"""US-49.4: plan usage limits, bounded retries, session recovery and the first-use notice."""

import json
import uuid

import httpx
import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEventType, AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.chatgpt import plan_client
from asterism.domains.llm import client as llm_client
from asterism.domains.llm.errors import LLMProviderError
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.schemas import LLMEventType, LLMMessage
from asterism.domains.settings import service as settings_service
from openai import AsyncOpenAI
from test_chatgpt_connection import chatgpt as _chatgpt
from test_chatgpt_connection import connect, enable
from test_chatgpt_plan_models import choices, plan_model_id
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
chatgpt = _chatgpt


def _sse(*events):
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def _response(status, **extra):
    return {"id": "r", "object": "response", "created_at": 0, "model": "gpt-plan", "status": status, "output": [],
            "parallel_tool_calls": True, "tool_choice": "auto", "tools": [], "usage": None, **extra}  # fmt: skip


def text(delta):
    return {"type": "response.output_text.delta", "delta": delta, "item_id": "m", "output_index": 0,
            "content_index": 0, "logprobs": [], "sequence_number": 1}  # fmt: skip


COMPLETED = {"type": "response.completed", "sequence_number": 2, "response": _response("completed")}


def ok(reply="Plan reply"):
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(text(reply), COMPLETED))


def failed(code):
    event = {"type": "response.failed", "sequence_number": 3,
             "response": _response("failed", error={"code": code, "message": code})}  # fmt: skip
    return event


def stream(*events):
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(*events))


def api_error(status, code):
    return httpx.Response(status, json={"error": {"code": code, "message": code, "param": None, "type": "x"}})


class ScriptedResponses:
    def __init__(self):
        self.replies: list[httpx.Response] = []
        self.tokens: list[str] = []

    def handle(self, request):
        self.tokens.append(request.headers["authorization"])
        return self.replies.pop(0) if self.replies else ok()


@pytest.fixture
def usage(chatgpt, monkeypatch):
    client, sessions, double = chatgpt
    responses = ScriptedResponses()
    sdk = AsyncOpenAI(
        api_key="chatgpt-plan",
        base_url="https://api.openai.com/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(responses.handle)),
    )
    monkeypatch.setitem(llm_client._shared_openai_clients, ("https://api.openai.com/v1", "chatgpt-plan"), sdk)
    monkeypatch.setattr(plan_client, "RETRY_DELAYS", (0.0, 0.0, 0.0))
    return client, sessions, double, responses


async def plan_llm(sessions):
    model = await settings_service.get_model_and_provider(uuid.UUID(await plan_model_id(sessions)), user_id="a")
    return create_llm_client(model.name, model.provider, user_id="a")


async def run(llm):
    return [event async for event in llm.chat(messages=[LLMMessage.user("Hi")])]


async def connection(client):
    return (await client.get("/chatgpt/connection", headers=auth("a"))).json()


@pytest.mark.asyncio
@pytest.mark.parametrize("reply", ["http", "stream"])
async def test_usage_limit_pauses_plan_requests_until_the_user_tries_again(usage, reply):
    client, sessions, double, responses = usage
    await enable(client)
    await connect(client, double)
    llm = await plan_llm(sessions)
    code = "subscription_sharing_usage_limit_exceeded"
    responses.replies.append(api_error(429, code) if reply == "http" else stream(failed(code)))

    events = await run(llm)

    assert [event.type for event in events] == [LLMEventType.ERROR]
    error = events[0].exception
    assert isinstance(error, LLMProviderError) and error.code == "chatgpt_plan_usage_limit"
    assert error.args[0] == "Usage limit reached. Review your plan or this app's limit in ChatGPT settings."
    assert len(responses.tokens) == 1
    assert (await connection(client))["usage_paused"] is True

    # Paused: no request reaches OpenAI, and pickers explain why with a stable code.
    paused = await run(llm)
    assert paused[0].exception.code == "chatgpt_plan_usage_limit"  # type: ignore[union-attr]
    assert len(responses.tokens) == 1
    choice = (await choices(client))[await plan_model_id(sessions)]
    assert (choice["available"], choice["unavailable_code"]) == (False, "chatgpt_plan_usage_limit")

    resumed = await client.post("/chatgpt/connection/resume", headers=auth("a"))
    assert resumed.json()["usage_paused"] is False
    assert (await run(llm))[-1].type == LLMEventType.COMPLETE


@pytest.mark.asyncio
async def test_usage_limit_after_output_is_not_retried_but_still_pauses(usage):
    client, sessions, double, responses = usage
    await enable(client)
    await connect(client, double)
    responses.replies.append(stream(text("partial"), failed("subscription_sharing_usage_limit_exceeded")))

    events = await run(await plan_llm(sessions))

    assert [event.type for event in events] == [LLMEventType.TEXT_DELTA, LLMEventType.ERROR]
    assert events[-1].exception.code == "chatgpt_plan_usage_limit"  # type: ignore[union-attr]
    assert len(responses.tokens) == 1
    assert (await connection(client))["usage_paused"] is True


@pytest.mark.asyncio
async def test_usage_unavailable_retries_with_bounded_backoff(usage):
    client, sessions, double, responses = usage
    await enable(client)
    await connect(client, double)
    llm = await plan_llm(sessions)

    responses.replies += [api_error(503, "subscription_sharing_usage_unavailable"),
                          stream(failed("subscription_sharing_user_unavailable")), ok()]  # fmt: skip
    events = await run(llm)
    assert events[-1].type == LLMEventType.COMPLETE
    assert [event.type for event in events].count(LLMEventType.ERROR) == 0
    assert len(responses.tokens) == 3

    responses.tokens.clear()
    responses.replies += [api_error(503, "subscription_sharing_usage_unavailable")] * 4
    events = await run(llm)
    assert [event.type for event in events] == [LLMEventType.ERROR]
    assert events[0].exception.code == "chatgpt_plan_temporarily_unavailable"  # type: ignore[union-attr]
    assert len(responses.tokens) == 4
    assert (await connection(client))["status"] == "connected"


@pytest.mark.asyncio
async def test_rejected_session_refreshes_once_then_retries(usage):
    client, sessions, double, responses = usage
    await enable(client)
    await connect(client, double)
    llm = await plan_llm(sessions)
    responses.replies += [api_error(401, "subscription_sharing_invalid_user"), ok()]

    events = await run(llm)

    assert events[-1].type == LLMEventType.COMPLETE
    assert responses.tokens == ["Bearer access-1", "Bearer access-2"]
    assert double.refresh_count == 1

    responses.tokens.clear()
    responses.replies += [api_error(401, "subscription_sharing_invalid_user")] * 2
    events = await run(llm)
    assert events[0].exception.code == "chatgpt_plan_session_rejected"  # type: ignore[union-attr]
    assert len(responses.tokens) == 2
    # Not a confirmed revocation: the connection is kept.
    assert (await connection(client))["status"] == "connected"


@pytest.mark.asyncio
async def test_revoked_session_asks_to_connect_again(usage):
    client, sessions, double, responses = usage
    await enable(client)
    await connect(client, double)
    llm = await plan_llm(sessions)
    responses.replies.append(api_error(401, "subscription_sharing_invalid_user"))
    double.token_replies.append(httpx.Response(400, json={"error": "refresh_token_invalidated"}))

    events = await run(llm)

    assert events[0].exception.code == "chatgpt_plan_reauthorization_required"  # type: ignore[union-attr]
    assert (await connection(client))["status"] == "reauthorization_required"
    choice = (await choices(client))[await plan_model_id(sessions)]
    assert choice["unavailable_code"] == "chatgpt_plan_reauthorization_required"


@pytest.mark.asyncio
async def test_agent_error_events_carry_the_plan_error_code(usage, monkeypatch):
    client, sessions, double, responses = usage
    await enable(client)
    await connect(client, double)
    llm = await plan_llm(sessions)
    responses.replies.append(api_error(403, "subscription_sharing_user_not_eligible"))
    profile = AgentProfile(name="Main", description="", sub_agent=False, model_id=None, system_prompt="",
                           max_steps=1, tools=[])  # fmt: skip
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", email="a@test.local", name="A", role="user"),
        session=Chat(info=ChatInfo(id=uuid.uuid4(), user_id="a", created_at=0, updated_at=0), messages=[]),
        allowed_tools=[],
    )

    async def get_client(self):
        return llm

    async def system_prompt(self):
        return ""

    monkeypatch.setattr(Agent, "_get_client", get_client)
    monkeypatch.setattr(Agent, "_build_system_prompt", system_prompt)
    events = [event async for event in agent.run([LLMMessage.user("Hi")])]

    assert events[-1].type == AgentEventType.ERROR
    assert events[-1].error_code == "chatgpt_plan_not_eligible"
    assert events[-1].model_dump()["error_code"] == "chatgpt_plan_not_eligible"


@pytest.mark.asyncio
async def test_first_use_notice_shows_once_per_registration(usage):
    client, _, double, _ = usage
    await enable(client)
    await connect(client, double)
    assert (await connection(client))["notice_pending"] is True

    dismissed = await client.post("/chatgpt/connection/notice", headers=auth("a"))
    assert dismissed.json()["notice_pending"] is False

    await client.post("/chatgpt/connection/disconnect", headers=auth("a"), json={})
    await connect(client, double)
    assert (await connection(client))["notice_pending"] is False
    assert (await client.post("/chatgpt/connection/notice", headers=auth("b"))).json()["notice_pending"] is False
