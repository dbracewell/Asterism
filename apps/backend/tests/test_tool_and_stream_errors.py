"""US-113.3: a failed tool or answer fails once, clearly."""

import asyncio
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import ChatJobManager
from asterism.domains.chat.message_queue import discard_message_queue, subscribe, unsubscribe
from asterism.domains.llm.client import StreamHandler
from asterism.domains.llm.schemas import Function, LLMEventType, LLMMessage, ToolCall, unique_tool_call_ids
from asterism.domains.tools.registry import ToolContext, ToolRegistry
from fastapi import WebSocketDisconnect
from pydantic import BaseModel
from test_agent_authorization_checks import StreamingClient, agent


class NoArgs(BaseModel):
    pass


def registry_raising(error: Exception) -> tuple[ToolRegistry, list[int]]:
    registry, attempts = ToolRegistry(), []

    @registry.tool(name="flaky")
    async def flaky(ctx: ToolContext[NoArgs]):
        attempts.append(1)
        raise error

    return registry, attempts


async def invoke(registry: ToolRegistry) -> dict:
    result = await registry.invoke_tool(
        tool_call=ToolCall(id="c1", function=Function(name="flaky", arguments="{}")),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        client=Mock(),
        session=Mock(),
        app_settings=SimpleNamespace(active_tools=["flaky"]),  # type: ignore[arg-type]
        max_retries=3,
    )
    return json.loads(result.content)


@pytest.fixture
def no_waits(monkeypatch):
    monkeypatch.setattr("asterism.domains.tools.registry._group_allows_tool", AsyncMock(return_value=True))
    monkeypatch.setattr("asterism.common.retries.asyncio.sleep", AsyncMock())


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [ValueError("bad date"), BadDataException("no such file")])
async def test_tool_errors_that_would_repeat_run_once_and_keep_their_message(no_waits, error):
    registry, attempts = registry_raising(error)
    assert await invoke(registry) == {"error": f"Tool failed with exception: {error}"}
    assert len(attempts) == 1


@pytest.mark.asyncio
async def test_unexpected_tool_errors_are_retried_and_reported_generically(no_waits):
    registry, attempts = registry_raising(RuntimeError("SELECT secret FROM /srv/data.db"))
    assert await invoke(registry) == {"error": "Tool failed unexpectedly (RuntimeError)"}
    assert len(attempts) == 4


class Answer(BaseModel):
    value: int


@pytest.mark.asyncio
async def test_a_structured_output_error_ends_the_stream_without_a_completion():
    handler = StreamHandler(response_model=Answer)
    handler.content = "not json"

    async def empty_stream():
        if False:
            yield None

    events = [event async for event in handler.process(empty_stream())]
    assert [event.type for event in events] == [LLMEventType.ERROR]


def call(call_id: str) -> ToolCall:
    return ToolCall(id=call_id, function=Function(name="web_search", arguments="{}"))


def test_repeated_and_blank_tool_call_ids_become_unique_and_first_ids_are_kept():
    calls = [call("a"), call("a"), call("a_2"), call(""), call("a")]
    assert [c.id for c in unique_tool_call_ids(calls)] == ["a", "a_2", "a_2_2", "call_3", "a_3"]
    assert unique_tool_call_ids(calls)[0] is calls[0]


@pytest.mark.asyncio
async def test_the_agent_approves_and_records_duplicate_calls_under_unique_ids():
    class TwinCalls(StreamingClient):
        async def chat(self, messages, tools, **kwargs):
            self.steps += 1
            self.seen = messages
            from asterism.domains.llm.schemas import LLMEvent

            yield LLMEvent(type=LLMEventType.START)
            twins = [call("dup"), call("dup")] if self.steps == 1 else None
            yield LLMEvent(type=LLMEventType.COMPLETE, content="", tool_calls=twins)

    client = TwinCalls(deltas=0)
    built = agent(AsyncMock(), client)
    stepped: list[list[str]] = []

    async def step_tools(tool_calls, last_user_message, results):
        stepped.append([c.id for c in tool_calls])
        if False:
            yield None

    built._step_tools = step_tools  # type: ignore[method-assign]
    _ = [event async for event in built.run([LLMMessage.user("Hi")])]
    assert stepped == [["dup", "dup_2"]]
    recorded = next(m for m in client.seen if m.role == "assistant")
    assert [c.id for c in recorded.tool_calls or []] == ["dup", "dup_2"]


class Socket:
    def __init__(self, commands: list[dict]):
        self.commands = commands
        self.sent: list[dict] = []

    async def receive_json(self):
        if not self.commands:
            raise WebSocketDisconnect()
        return self.commands.pop(0)

    async def send_json(self, packet):
        self.sent.append(packet)


def controller(commands: list[dict], **runtime) -> tuple[ChatController, ChatJobManager]:
    manager = ChatJobManager()
    job = manager.get_or_create(
        uuid.uuid4(),
        SimpleNamespace(pending_approvals={}, generate_chat_title=AsyncMock(), is_active=False, **runtime),
        user_id="a",
    )
    built = ChatController(job.chat_id, Socket(commands), job, manager.admit_controller("a"))  # type: ignore[arg-type]
    built._is_running = True
    return built, manager


@pytest.mark.asyncio
async def test_tool_approvals_accept_only_true_or_false():
    resolve = Mock()
    commands = [
        {"type": "tool_approval", "tool_id": "c1", "approved": "false"},
        {"type": "tool_approval", "tool_id": "c1", "approved": 1},
        {"type": "tool_approval", "tool_id": "c1"},
        {"type": "tool_approval", "tool_id": None, "approved": True},
        {"type": "tool_approval", "tool_id": "c1", "approved": False},
        {"type": "tool_approval", "tool_id": "c2", "approved": True},
    ]
    built, _ = controller(commands, resolve_tool_approval=resolve)
    with pytest.raises(WebSocketDisconnect):
        await built._accept_commands_loop()
    assert [c.args for c in resolve.call_args_list] == [("c1", False), ("c2", True)]
    discard_message_queue(built.chat_id)


@pytest.mark.asyncio
async def test_regenerate_is_refused_while_a_reply_is_running():
    regenerate = AsyncMock()
    built, manager = controller([], reload_chat=regenerate)
    built._admit_new_run = AsyncMock()  # type: ignore[method-assign]
    running = asyncio.Event()

    async def reply():
        running.set()
        await asyncio.Event().wait()

    built.job.start(reply())
    await running.wait()
    processing = asyncio.create_task(built._process_commands_loop())
    await built.inbound_commands.put({"type": "regenerate", "parent_message_id": "x"})
    await built.inbound_commands.join()
    built._admit_new_run.assert_not_awaited()
    regenerate.assert_not_awaited()
    processing.cancel()
    await asyncio.gather(processing, return_exceptions=True)
    await manager.shutdown()
    discard_message_queue(built.chat_id)


@pytest.mark.asyncio
async def test_the_regenerate_notice_reaches_every_open_tab():
    parent = SimpleNamespace(id=uuid.uuid4())
    built, manager = controller(
        [],
        reload_chat=AsyncMock(),
        find_message=Mock(return_value=(0, parent)),
        handle_regenerate_message=AsyncMock(),
    )
    tabs = [subscribe(built.chat_id)[0] for _ in range(2)]
    await built._regenerate(str(parent.id))
    notice = {"type": "regenerate", "parent_id": str(parent.id)}
    assert [tab.get_nowait() for tab in tabs] == [notice, notice]
    assert built.connection.sent == []  # type: ignore[attr-defined]
    for tab in tabs:
        unsubscribe(built.chat_id, tab)
    await manager.shutdown()
    discard_message_queue(built.chat_id)


@pytest.mark.asyncio
async def test_a_resumed_turn_starts_the_title_after_reloading_the_chat():
    """US-117.2: a chat opened before its first message still gets a title."""
    order: list[str] = []
    reload_chat = AsyncMock(side_effect=lambda: order.append("reload"))
    resume = AsyncMock(side_effect=lambda **kwargs: order.append(f"resume reload={kwargs.get('reload')}"))
    built, manager = controller([], reload_chat=reload_chat, resume_pending_turn=resume)
    title = built.job.orchestrator.generate_chat_title
    title.side_effect = lambda: order.append("title")
    built.job.controllers += 1  # This controller is attached, so the idle job stays.
    await built.job.start_title_generation()  # The first attempt, when the chat opened empty.
    processing = asyncio.create_task(built._process_commands_loop())
    await built.inbound_commands.put({"type": "resume"})
    await built.inbound_commands.join()
    # Reloaded once, then the title (its own task) and the turn run side by side.
    assert order[:2] == ["title", "reload"]
    assert sorted(order[2:]) == ["resume reload=False", "title"]
    built.job.controllers -= 1
    processing.cancel()
    await asyncio.gather(processing, return_exceptions=True)
    await manager.shutdown()
    discard_message_queue(built.chat_id)
