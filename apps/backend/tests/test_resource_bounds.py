import asyncio
import time

import pytest
from asterism.common.cache import SlidingTTLCache
from asterism.core.events import (
    MAX_EVENT_HANDLER_TASKS,
    EventBus,
    EventType,
    NoArgEvent,
)
from asterism.domains.llm.token_counting import (
    _encoding,
    encoding_cache_size,
    estimate_text_tokens,
)


def test_sliding_ttl_cache_expires_idle_entries_and_bounds_size():
    cache = SlidingTTLCache[str, int](maxsize=2, ttl=0.01)
    cache["first"] = 1
    cache["second"] = 2
    cache["third"] = 3
    assert len(cache) == 2

    assert cache.get("second") == 2
    time.sleep(0.02)
    assert len(cache) == 0


def test_token_encoding_cache_evicts_high_cardinality_model_names():
    _encoding.cache_clear()

    for index in range(129):
        assert estimate_text_tokens("hello", f"admin-model-{index}") == 1

    assert encoding_cache_size() == 128
    assert estimate_text_tokens("hello", "gpt-4") == 1
    assert encoding_cache_size() == 128


@pytest.mark.asyncio
async def test_event_bus_bounds_dispatches_and_releases_completed_tasks():
    bus = EventBus()
    started = asyncio.Event()
    release = asyncio.Event()

    @bus.on(EventType.SYSTEM_START)
    async def slow_handler(_event):
        started.set()
        await release.wait()

    for _ in range(MAX_EVENT_HANDLER_TASKS + 1):
        bus.emit(NoArgEvent(type=EventType.SYSTEM_START))

    await started.wait()
    assert bus.pending_task_count == MAX_EVENT_HANDLER_TASKS
    assert bus.dropped_handler_dispatches == 1

    release.set()
    await asyncio.sleep(0)
    await bus.shutdown()
    assert bus.pending_task_count == 0


@pytest.mark.asyncio
async def test_event_bus_suppresses_handler_failure_and_cancels_on_shutdown():
    bus = EventBus()
    cancelled = asyncio.Event()

    @bus.on(EventType.SYSTEM_START)
    async def failing_handler(_event):
        raise RuntimeError("expected handler failure")

    @bus.on(EventType.SYSTEM_STOP)
    async def blocked_handler(_event):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    bus.emit(NoArgEvent(type=EventType.SYSTEM_START))
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert bus.pending_task_count == 0

    bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))
    await asyncio.sleep(0)
    await bus.shutdown()
    assert cancelled.is_set()
    assert bus.pending_task_count == 0


@pytest.mark.asyncio
async def test_event_bus_emits_webhook_async(monkeypatch):
    from asterism.core.events import Event
    from pydantic import BaseModel

    class TestPayload(BaseModel):
        msg: str

    called_async = asyncio.Event()

    async def fake_post_async(event_type: str, payload: dict, user_id: str | None = None):
        assert event_type == "chat-session:update"
        assert payload == {"msg": "hello"}
        assert user_id == "u123"
        called_async.set()

    monkeypatch.setattr("asterism.core.events.post_webhook_async", fake_post_async)

    bus = EventBus()
    event = Event(
        type=EventType.WEBHOOK_CHAT_UPDATE,
        payload=TestPayload(msg="hello"),
        user_id="u123",
    )
    bus.emit(event)
    await asyncio.wait_for(called_async.wait(), timeout=1.0)
    await bus.shutdown()


def test_event_bus_emits_webhook_sync_without_running_loop(monkeypatch):
    from asterism.core.events import Event
    from pydantic import BaseModel

    class TestPayload(BaseModel):
        msg: str

    called_sync = []

    def fake_post_sync(event_type: str, payload: dict, user_id: str | None = None):
        called_sync.append((event_type, payload, user_id))

    monkeypatch.setattr("asterism.core.events.post_webhook", fake_post_sync)

    bus = EventBus()
    event = Event(
        type=EventType.WEBHOOK_CHAT_UPDATE,
        payload=TestPayload(msg="hello"),
        user_id="u123",
    )
    bus.emit(event)
    assert len(called_sync) == 1
    assert called_sync[0] == ("chat-session:update", {"msg": "hello"}, "u123")


@pytest.mark.asyncio
async def test_post_webhook_async(monkeypatch):
    import httpx
    from asterism.core.events import post_webhook_async

    captured_request = {}

    async def fake_post(self, url, headers=None, json=None):
        captured_request["url"] = url
        captured_request["headers"] = headers
        captured_request["json"] = json
        return httpx.Response(status_code=200, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    await post_webhook_async(
        event_type="chat-session:update",
        payload={"session_id": "s1"},
        user_id="user1",
    )

    assert "/api/stream" in captured_request["url"]
    assert captured_request["json"]["type"] == "chat-session:update"
    assert captured_request["json"]["payload"] == {"session_id": "s1"}
    assert captured_request["json"]["userId"] == "user1"
