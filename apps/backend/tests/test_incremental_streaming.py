"""US-120.2: the server streams only new text (ADR-0084)."""

import asyncio
import json
import uuid

import pytest
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import ChatJobManager
from asterism.domains.chat.message_queue import discard_message_queue, get_message_queue
from asterism.domains.chat.text_streams import TextStream, TextStreams
from fastapi import WebSocketDisconnect
from test_chat_multi_tab_streams import Tab, runtime, until
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


def rebuild(packets: list[dict]) -> dict[str, tuple[int, str, str]]:
    """What a reader that applies the packets in order ends with, per stream."""
    streams: dict[str, tuple[int, str, str]] = {}
    for packet in packets:
        seq, content, thinking = streams.get(packet["stream"], (0, "", ""))
        if packet["mode"] == "replace":
            assert packet["seq"] >= seq
            streams[packet["stream"]] = (packet["seq"], packet["content"], packet["thinking"])
        else:
            assert packet["seq"] == seq + 1
            streams[packet["stream"]] = (packet["seq"], content + packet["content"], thinking + packet["thinking"])
    return streams


def test_a_stream_appends_new_text_and_replaces_text_that_shrank():
    stream = TextStream()
    first = stream.delta("Hel", "")
    assert first is not None
    assert (first["seq"], first["mode"], first["content"]) == (1, "append", "Hel")
    second = stream.delta("Hello", "think")
    assert second is not None
    assert (second["seq"], second["mode"], second["content"], second["thinking"]) == (2, "append", "lo", "think")
    assert stream.delta("Hello", "think") is None
    # Shorter text (an exercise's held-back marker trimmed) is sent whole.
    third = stream.delta("Hell", "think")
    assert third is not None
    assert (third["seq"], third["mode"], third["content"]) == (3, "replace", "Hell")
    assert stream.snapshot() == {
        "stream": stream.stream,
        "seq": 3,
        "mode": "replace",
        "content": "Hell",
        "thinking": "think",
    }


def test_streams_snapshot_the_open_reply_and_sub_agents():
    streams = TextStreams()
    assert streams.snapshots() == []
    main = streams.main_delta("Answer", "")
    envelope = {"type": "sub_agent", "execution_id": "child-1", "sub_agent_name": "Researcher", "depth": 1}
    child = streams.child_delta(envelope, "Looking", "")
    assert main is not None and child is not None
    assert child["sub_agent_name"] == "Researcher" and child["event"]["mode"] == "append"

    snapshots = streams.snapshots()
    assert [packet["type"] for packet in snapshots] == ["delta", "sub_agent"]
    assert snapshots[0]["content"] == "Answer" and snapshots[0]["seq"] == 1
    assert snapshots[1]["event"]["content"] == "Looking" and snapshots[1]["event"]["stream"] == child["event"]["stream"]

    streams.end_child("child-1")
    streams.end_main()
    assert streams.snapshots() == []
    next_step = streams.main_delta("Next", "")
    assert next_step is not None and next_step["stream"] != main["stream"] and next_step["seq"] == 1


@pytest.mark.asyncio
async def test_a_long_reply_sends_about_its_own_length(project_api, monkeypatch):
    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.schemas import AgentEvent, AgentEventType
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one
    from test_chat_comparisons import Runtime

    client, sessions, _ = project_api
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Write at length",
        },
    )
    chat_id = uuid.UUID(response.json()["info"]["id"])
    Runtime(chat_id, sessions, monkeypatch)
    async with sessions() as session:
        opened = await get_one(chat_id, "a", session)
        profile = await get_main_agent_profile("a", session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", name="A", email="a@example.test", role="user"),
        session=opened,
        model_id=opened.info.selected_model_id,
    )
    words = [f"word{index} " for index in range(2000)]
    full = "".join(words).strip()

    async def generate(*, messages, replay=None):
        yield AgentEvent(type=AgentEventType.START)
        text = ""
        for word in words:
            text += word
            yield AgentEvent(type=AgentEventType.DELTA, content=text.strip(), thinking="")
        yield AgentEvent(type=AgentEventType.COMPLETE, content=full)

    monkeypatch.setattr(agent, "run", generate)
    orchestrator = ChatOrchestrator(agent)
    # Record every packet: the stream itself keeps only the newest 256 while no tab is attached.
    emitted: list[dict] = []
    emit = orchestrator._emit

    async def record(packet):
        emitted.append(packet)
        await emit(packet)

    monkeypatch.setattr(orchestrator, "_emit", record)
    await orchestrator.resume_pending_turn()

    deltas = [packet for packet in emitted if packet["type"] == "delta"]
    assert len(deltas) == len(words)
    (_, content, _), *others = rebuild(deltas).values()
    assert content == full and others == []
    # Whole-text packets would send about len(full) * len(words) / 2 bytes.
    sent = sum(len(json.dumps(packet)) for packet in deltas)
    assert sent < 20 * len(full)
    assert orchestrator.stream_snapshots() == []


@pytest.mark.asyncio
async def test_a_tab_gets_the_text_so_far_on_joining_and_on_resync():
    manager, chat_id, gate = ChatJobManager(), uuid.uuid4(), asyncio.Event()
    orchestrator = runtime(chat_id, gate, [])
    streams = TextStreams()
    streams.main_delta("The story so far", "")
    orchestrator.stream_snapshots = streams.snapshots
    job = manager.get_or_create(chat_id, orchestrator, user_id="user-a")

    class ResyncingTab(Tab):
        def __init__(self):
            super().__init__()
            self.commands: asyncio.Queue[dict] = asyncio.Queue()

        async def receive_json(self):
            command = asyncio.ensure_future(self.commands.get())
            closed = asyncio.ensure_future(self.closed.wait())
            done, pending = await asyncio.wait({command, closed}, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            if command in done:
                return command.result()
            raise WebSocketDisconnect()

    tab = ResyncingTab()
    controller = ChatController(chat_id, tab, job, manager.admit_controller("user-a"))  # type: ignore[arg-type]
    task = asyncio.create_task(controller.run())

    def replaced() -> list[dict]:
        return [packet for packet in tab.sent if packet.get("mode") == "replace"]

    await until(lambda: len(replaced()) == 1)
    assert replaced()[0]["content"] == "The story so far" and replaced()[0]["seq"] == 1

    streams.main_delta("The story so far, and more", "")
    await tab.commands.put({"type": "resync"})
    await until(lambda: len(replaced()) == 2)
    assert replaced()[1]["content"] == "The story so far, and more" and replaced()[1]["seq"] == 2

    tab.closed.set()
    gate.set()
    await task
    await job.task
    assert get_message_queue(chat_id).subscriber_count == 0
    discard_message_queue(chat_id)


@pytest.mark.asyncio
async def test_sub_agent_deltas_stream_increments_per_child():
    from types import SimpleNamespace

    from asterism.domains.agent.schemas import AgentEvent, AgentEventType, SubAgentEventEnvelope
    from asterism.domains.chat.orchestrator import ChatOrchestrator

    sent: list[dict] = []

    async def emit(packet):
        sent.append(packet)

    fake = SimpleNamespace(_text_streams=TextStreams(), _emit=emit)
    children = [uuid.uuid4(), uuid.uuid4()]

    def envelope(execution_id, event):
        return SubAgentEventEnvelope(
            execution_id=execution_id, sub_agent_id=uuid.uuid4(), sub_agent_name="Helper", depth=1, event=event
        )

    for text in ("Rea", "Reading", "Reading notes"):
        for child in children:
            event = AgentEvent(type=AgentEventType.DELTA, content=f"{text} {child.hex[:4]}")
            await ChatOrchestrator._emit_sub_agent(fake, envelope(child, event))  # type: ignore[arg-type]
    await ChatOrchestrator._emit_sub_agent(  # type: ignore[arg-type]
        fake, envelope(children[0], AgentEvent(type=AgentEventType.COMPLETE, content="Done"))
    )

    deltas = [packet["event"] for packet in sent if packet["event"]["type"] == "delta"]
    rebuilt = rebuild(deltas)
    assert sorted(content for _, content, _ in rebuilt.values()) == sorted(
        f"Reading notes {child.hex[:4]}" for child in children
    )
    assert all(packet["sub_agent_name"] == "Helper" for packet in sent)
    # The finished child's stream is closed; the other is still open for a joining tab.
    assert [packet["execution_id"] for packet in fake._text_streams.snapshots()] == [str(children[1])]
