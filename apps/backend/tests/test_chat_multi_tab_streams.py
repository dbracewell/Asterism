"""US-77.3: every controller attached to a chat receives the full stream."""

import asyncio
import time
import uuid
from types import SimpleNamespace

import pytest
from asterism.common.cache import SlidingTTLCache
from asterism.domains.chat import message_queue
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import ChatJobManager
from asterism.domains.chat.message_queue import (
    MAX_QUEUED_PACKETS,
    discard_message_queue,
    get_message_queue,
    message_queue_count,
    subscribe,
    unsubscribe,
)
from fastapi import WebSocketDisconnect


class Tab:
    """A WebSocket that records what it was sent and stays open until closed."""

    def __init__(self):
        self.sent: list[dict] = []
        self.closed = asyncio.Event()

    async def accept(self):
        pass

    async def receive_json(self):
        await self.closed.wait()
        raise WebSocketDisconnect()

    async def send_json(self, packet):
        self.sent.append(packet)

    async def heartbeat_loop(self):
        await asyncio.Event().wait()

    def stream(self) -> list[tuple[str, str]]:
        return [(p["type"], p.get("content", "")) for p in self.sent if p["type"] in {"delta", "complete"}]


def deltas(count: int) -> list[dict]:
    return [{"type": "delta", "content": "x" * (index + 1), "thinking": ""} for index in range(count)]


async def until(condition):
    for _ in range(1000):
        if condition():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition never held")


def runtime(chat_id, gate: asyncio.Event, packets: list[dict]):
    async def resume_pending_turn():
        await gate.wait()
        stream = get_message_queue(chat_id)
        for packet in packets:
            await stream.put(packet)

    return SimpleNamespace(
        resume_pending_turn=resume_pending_turn,
        generate_chat_title=lambda: asyncio.sleep(0),
        is_active=False,
        pending_approvals={},
    )


def attach(manager, chat_id, job, tab) -> asyncio.Task:
    controller = ChatController(chat_id, tab, job, manager.admit_controller("user-a"))  # type: ignore[arg-type]
    return asyncio.create_task(controller.run())


@pytest.mark.asyncio
async def test_two_tabs_on_one_chat_both_receive_every_delta_and_complete():
    manager, chat_id, gate = ChatJobManager(), uuid.uuid4(), asyncio.Event()
    packets = [*deltas(50), {"type": "complete", "last_messages": []}]
    job = manager.get_or_create(chat_id, runtime(chat_id, gate, packets), user_id="user-a")
    first, second = Tab(), Tab()
    tasks = [attach(manager, chat_id, job, first), attach(manager, chat_id, job, second)]
    await until(lambda: get_message_queue(chat_id).subscriber_count == 2)

    gate.set()
    expected = [(packet["type"], packet.get("content", "")) for packet in packets]
    await until(lambda: first.stream() == expected and second.stream() == expected)

    for tab in (first, second):
        tab.closed.set()
    await asyncio.gather(*tasks)
    await job.task
    assert get_message_queue(chat_id).subscriber_count == 0
    discard_message_queue(chat_id)


@pytest.mark.asyncio
async def test_detach_and_reattach_loses_nothing_within_the_bound():
    manager, chat_id, gate = ChatJobManager(), uuid.uuid4(), asyncio.Event()
    job = manager.get_or_create(chat_id, runtime(chat_id, gate, []), user_id="user-a")
    first = Tab()
    task = attach(manager, chat_id, job, first)
    await until(lambda: get_message_queue(chat_id).subscriber_count == 1)
    first.closed.set()
    await task

    # Packets produced while no tab is attached are buffered for the next one.
    stream = get_message_queue(chat_id)
    for packet in [*deltas(3), {"type": "complete", "last_messages": []}]:
        await stream.put(packet)
    reopened = Tab()
    task = attach(manager, chat_id, job, reopened)
    await until(lambda: len(reopened.stream()) == 4)
    assert reopened.stream() == [("delta", "x"), ("delta", "xx"), ("delta", "xxx"), ("complete", "")]
    reopened.closed.set()
    await task
    discard_message_queue(chat_id)


def test_a_leaving_tab_hands_back_unsent_packets_only_when_it_is_the_last():
    chat_id = uuid.uuid4()
    stream = get_message_queue(chat_id)
    stream.put_nowait({"type": "delta", "content": "buffered"})
    first, replayed = subscribe(chat_id)
    second, second_replayed = subscribe(chat_id)
    # Only the first tab to attach is replayed the buffer.
    assert (replayed, second_replayed) == (1, 0)
    stream.put_nowait({"type": "delta", "content": "both"})
    assert (first.qsize(), second.qsize()) == (2, 1)

    unsubscribe(chat_id, first)  # Another tab still receives the stream.
    assert stream.qsize() == 0
    unsubscribe(chat_id, second)  # The last tab's unsent packet is buffered again.
    assert stream.get_nowait() == {"type": "delta", "content": "both"}
    discard_message_queue(chat_id)


def test_each_subscriber_is_bounded_and_keeps_the_newest_packets():
    chat_id = uuid.uuid4()
    subscriber, _ = subscribe(chat_id)
    stream = get_message_queue(chat_id)
    for index in range(MAX_QUEUED_PACKETS + 1):
        stream.put_nowait({"index": index})
    assert subscriber.qsize() == MAX_QUEUED_PACKETS
    assert subscriber.dropped_packets == 1
    assert subscriber.get_nowait() == {"index": 1}
    discard_message_queue(chat_id)
    assert subscriber.empty()


def test_an_attached_stream_never_expires_and_discard_releases_it(monkeypatch):
    cache = SlidingTTLCache[uuid.UUID, message_queue.ChatStream](maxsize=2, ttl=0.001)
    monkeypatch.setattr(message_queue, "_queue_cache", cache)
    baseline = message_queue_count()
    chat_id = uuid.uuid4()
    stream = get_message_queue(chat_id)
    subscriber, _ = subscribe(chat_id)

    time.sleep(0.01)
    # Producers still reach the attached tab after the idle TTL.
    assert get_message_queue(chat_id) is stream
    stream.put_nowait({"type": "delta"})
    assert subscriber.qsize() == 1

    unsubscribe(chat_id, subscriber)
    time.sleep(0.01)
    assert get_message_queue(chat_id) is not stream  # Idle again, so the TTL applies.
    discard_message_queue(chat_id)
    assert message_queue_count() == baseline


@pytest.mark.asyncio
async def test_a_closing_socket_ends_the_status_loop_without_an_error_line(caplog):
    """A tab closing while a status packet is sent is ordinary, not an error (US-86.7)."""
    manager, chat_id, gate = ChatJobManager(), uuid.uuid4(), asyncio.Event()
    job = manager.get_or_create(chat_id, runtime(chat_id, gate, []), user_id="user-a")

    class ClosingTab(Tab):
        async def send_json(self, packet):
            if packet["type"] == "status":
                self.closed.set()
                raise WebSocketDisconnect(code=1006)
            await super().send_json(packet)

    tab = ClosingTab()
    task = attach(manager, chat_id, job, tab)
    await asyncio.wait_for(tab.closed.wait(), 5)
    await asyncio.wait_for(task, 5)
    gate.set()
    await job.task
    assert not [record for record in caplog.records if record.levelname == "ERROR"]
    discard_message_queue(chat_id)
