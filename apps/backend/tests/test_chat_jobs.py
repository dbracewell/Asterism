import asyncio
import uuid
from types import SimpleNamespace

import pytest
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import ChatJobManager
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import (
    Chat,
    ChatInfo,
    Message,
    MessageStatus,
)


@pytest.mark.asyncio
async def test_chat_job_is_shared_and_disconnect_safe():
    manager = ChatJobManager()
    chat_id = uuid.uuid4()
    started = asyncio.Event()
    release = asyncio.Event()
    cancelled = False

    async def run_agent():
        started.set()
        await release.wait()

    async def cancel_active_generation():
        nonlocal cancelled
        cancelled = True

    orchestrator = SimpleNamespace(
        run_agent=run_agent,
        cancel_active_generation=cancel_active_generation,
    )
    job = manager.get_or_create(chat_id, orchestrator)
    # A later WebSocket must attach to the first runtime, not replace it.
    assert manager.get_or_create(chat_id, SimpleNamespace()) is job

    task = job.start(orchestrator.run_agent())
    await started.wait()
    assert job.is_active

    # Nothing in a connection/controller can cancel this task; it completes
    # only when the job itself finishes.
    release.set()
    await task
    assert not job.is_active
    assert not cancelled


@pytest.mark.asyncio
async def test_controller_disconnect_does_not_cancel_the_chat_job():
    class DisconnectingConnection:
        async def accept(self):
            pass

        async def receive_json(self):
            from fastapi import WebSocketDisconnect

            raise WebSocketDisconnect()

        async def send_json(self, _data):
            pass

        async def heartbeat_loop(self):
            await asyncio.Event().wait()

    manager = ChatJobManager()
    chat_id = uuid.uuid4()
    started = asyncio.Event()
    release = asyncio.Event()

    async def run_agent():
        started.set()
        await release.wait()

    orchestrator = SimpleNamespace(
        run_agent=run_agent,
        generate_chat_title=lambda: asyncio.sleep(0),
        is_active=False,
    )
    job = manager.get_or_create(chat_id, orchestrator)
    controller = ChatController(
        chat_id=chat_id,
        connection=DisconnectingConnection(),
        job=job,
    )

    await controller.run()
    await started.wait()
    assert job.is_active

    release.set()
    await job.task
    assert not job.is_active


@pytest.mark.asyncio
async def test_cancelling_persists_a_terminal_partial_response(monkeypatch):
    chat_id = uuid.uuid4()
    parent_id = uuid.uuid4()
    parent = Message(
        id=parent_id,
        user_id="user-a",
        role="user",
        content="Tell me something",
        token_count=0,
        status=MessageStatus.PENDING,
        created_at=1,
    )
    chat = Chat(
        info=ChatInfo(
            id=chat_id,
            user_id="user-a",
            created_at=1,
            updated_at=1,
        ),
        messages=[parent],
    )
    agent = SimpleNamespace(
        session=chat,
        profile=SimpleNamespace(model_id=uuid.uuid4()),
    )
    orchestrator = ChatOrchestrator(agent)
    added = []
    updated = []

    async def add_message(**kwargs):
        added.append(kwargs["message"])
        return Message(
            id=uuid.uuid4(),
            user_id="user-a",
            role="assistant",
            content=kwargs["message"].content,
            token_count=0,
            status=kwargs["message"].status,
            created_at=2,
        )

    async def update_message(**kwargs):
        updated.append(kwargs["payload"])
        return parent.model_copy(update={"status": kwargs["payload"].status})

    monkeypatch.setattr(
        "asterism.domains.chat.orchestrator.chat_service.add_message", add_message
    )
    monkeypatch.setattr(
        "asterism.domains.chat.orchestrator.chat_service.update_message",
        update_message,
    )
    orchestrator._active_parent_id = parent_id
    orchestrator._streaming_content = "A partial answer"

    await orchestrator.cancel_active_generation()

    assert added[0].status is MessageStatus.CANCELLED
    assert added[0].content == "A partial answer"
    assert updated[0].status is MessageStatus.CANCELLED
    assert chat.messages[0].status is MessageStatus.CANCELLED


@pytest.mark.asyncio
async def test_explicit_job_cancel_finalizes_the_active_generation():
    manager = ChatJobManager()
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def run_agent():
        started.set()
        await asyncio.Event().wait()

    async def cancel_active_generation():
        cancelled.set()

    orchestrator = SimpleNamespace(
        run_agent=run_agent,
        cancel_active_generation=cancel_active_generation,
    )
    job = manager.get_or_create(uuid.uuid4(), orchestrator)
    task = job.start(orchestrator.run_agent())
    await started.wait()

    assert job.cancel()
    await task
    assert cancelled.is_set()
    assert not job.cancel()
