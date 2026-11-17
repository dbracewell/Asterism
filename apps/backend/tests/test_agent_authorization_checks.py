"""US-77.1: live authorization runs per step and stream boundary, never per streamed token."""

import uuid
from unittest.mock import AsyncMock

import pytest
from asterism.core.exceptions import ForbiddenException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEvent, AgentEventType, AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.llm.schemas import Function, LLMEvent, LLMEventType, LLMMessage, ToolCall
from asterism.domains.tools.builtin import sub_agent

MODEL = uuid.UUID(int=1)


class StreamingClient:
    """Streams ``deltas`` text deltas per step; the first step asks for one tool when ``tool`` is set."""

    def __init__(self, deltas: int, tool: bool = False):
        self.deltas = deltas
        self.tool = tool
        self.steps = 0

    async def chat(self, messages, tools, **kwargs):
        self.steps += 1
        yield LLMEvent(type=LLMEventType.START)
        for index in range(self.deltas):
            yield LLMEvent(type=LLMEventType.TEXT_DELTA, content="x" * (index + 1))
        calls = (
            [ToolCall(id="c1", function=Function(name="web_search", arguments="{}"))]
            if self.tool and self.steps == 1
            else None
        )
        yield LLMEvent(type=LLMEventType.COMPLETE, content="x" * self.deltas, tool_calls=calls)


def agent(check, client: StreamingClient) -> Agent:
    profile = AgentProfile.model_validate(
        {
            "name": "Researcher",
            "description": "",
            "sub_agent": True,
            "model_id": MODEL,
            "system_prompt": None,
            "max_steps": 3,
            "tools": ["web_search"],
        }
    )
    built = Agent(
        profile=profile,
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=Chat(info=ChatInfo(id=uuid.uuid4(), user_id="a", created_at=0, updated_at=0), messages=[]),
        authorization_check=check,
    )
    built._get_client = AsyncMock(return_value=client)  # type: ignore[method-assign]
    built._build_system_prompt = AsyncMock(return_value="")  # type: ignore[method-assign]
    built.resolve_tools = AsyncMock(return_value=["web_search"])  # type: ignore[method-assign]
    return built


async def checks_for(deltas: int) -> int:
    check = AsyncMock()
    events = [event async for event in agent(check, StreamingClient(deltas)).run([LLMMessage.user("Hi")])]
    assert sum(event.type == AgentEventType.DELTA for event in events) == deltas
    return check.await_count


@pytest.mark.asyncio
async def test_a_streamed_reply_performs_a_constant_number_of_checks():
    # Run start, step start, stream START and COMPLETE: the same for 1 or 500 deltas.
    assert await checks_for(1) == await checks_for(500) == 4


@pytest.mark.asyncio
async def test_revoked_access_stops_the_turn_before_tools_run(monkeypatch):
    revoked = False

    async def check():
        if revoked:
            raise ForbiddenException("Access revoked")

    tools = AsyncMock()
    built = agent(check, StreamingClient(3, tool=True))
    monkeypatch.setattr(built, "_step_tools", tools)
    events = []
    with pytest.raises(ForbiddenException):
        async for event in built.run([LLMMessage.user("Hi")]):
            events.append(event)
            if event.type == AgentEventType.DELTA:
                revoked = True  # Revoked mid-stream.
    assert events[-1].type == AgentEventType.DELTA
    tools.assert_not_called()


@pytest.mark.asyncio
async def test_sub_agent_deltas_are_not_checked_one_by_one(monkeypatch):
    monkeypatch.setattr(sub_agent, "_AUTH_POLL_INTERVAL", 60)

    async def child():
        yield AgentEvent(type=AgentEventType.START)
        for _ in range(200):
            yield AgentEvent(type=AgentEventType.DELTA, content="x")
        yield AgentEvent(type=AgentEventType.COMPLETE, content="done")

    check = AsyncMock()
    forwarded = [event async for event in sub_agent._authorized_events(child(), check)]
    assert len(forwarded) == 202
    # Once on entry, then before forwarding START and COMPLETE.
    assert check.await_count == 3

    async def revoked():
        raise ForbiddenException("Delegation revoked")

    with pytest.raises(ForbiddenException):
        async for _ in sub_agent._authorized_events(child(), revoked):
            pass
