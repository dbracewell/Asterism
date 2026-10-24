"""Admission counts work, not sockets; all denied calls remain allocation-free."""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from asterism.core.exceptions import CodedException
from asterism.domains.chat.capacity import ChatCapacityError, ChatCapacityLimits
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import ChatJobManager
from asterism.domains.chat.message_queue import message_queue_count


def manager():
    return ChatJobManager(ChatCapacityLimits(2, 1, 3, 2))


def job(manager, owner="a", **runtime):
    return manager.get_or_create(
        uuid.uuid4(),
        SimpleNamespace(
            pending_approvals={},
            cancel_active_generation=AsyncMock(),
            generate_chat_title=AsyncMock(),
            **runtime,
        ),
        user_id=owner,
    )


@pytest.mark.asyncio
async def test_concurrent_work_rejects_per_owner_and_global_without_waiting():
    jobs = manager()
    candidates = [job(jobs, owner) for owner in ("a", "a", "b", "c")]
    started = []

    async def admit(candidate):
        try:
            started.append(candidate.start(asyncio.sleep(30)))
            return True
        except ChatCapacityError as error:
            assert error.packet()["retryable"] is True
            assert error.code == 503
            return False

    assert await asyncio.gather(*(admit(candidate) for candidate in candidates)) == [True, False, True, False]
    assert jobs.active_count == 2
    assert candidates[1].task is candidates[3].task is None
    await jobs.shutdown()
    assert jobs.active_count == jobs.count == 0


@pytest.mark.asyncio
async def test_concurrent_controllers_are_owner_scoped_and_idempotently_released():
    jobs = manager()

    async def admit(owner):
        try:
            return jobs.admit_controller(owner)
        except ChatCapacityError:
            return None

    tokens = await asyncio.gather(*(admit(owner) for owner in ("a", "a", "a", "b", "c")))
    assert [token is not None for token in tokens] == [True, True, False, True, False]
    assert jobs.controller_count == 3 and jobs.count == 0
    tokens[0].release()
    tokens[0].release()
    replacement = jobs.admit_controller("c")
    assert jobs.controller_count == 3
    await jobs.shutdown()
    replacement.release()
    assert jobs.controller_count == 0
    with pytest.raises(ChatCapacityError):
        jobs.admit_controller("a")


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["success", "failure", "cancel", "cancel_before_start"])
async def test_work_terminal_paths_release_capacity(terminal):
    jobs = manager()
    candidate = job(jobs)
    token = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, token)
    entered = asyncio.Event()

    async def operation():
        entered.set()
        if terminal == "failure":
            raise RuntimeError("provider failed")
        if terminal.startswith("cancel"):
            await asyncio.sleep(30)

    task = candidate.start(operation())
    if terminal == "cancel_before_start":
        task.cancel()
    else:
        await entered.wait()
        if terminal == "cancel":
            candidate.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await asyncio.sleep(0)
    assert jobs.active_count == 0
    await candidate.start(asyncio.sleep(0))
    await jobs.shutdown()


@pytest.mark.asyncio
async def test_title_and_approval_hold_shared_work_slot_until_all_complete():
    jobs = manager()
    title_release = asyncio.Event()
    candidate = job(jobs)
    candidate.orchestrator.generate_chat_title = title_release.wait
    token = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, token)
    candidate.start_title_generation()
    await candidate.start(asyncio.sleep(0))
    assert jobs.active_count == 1
    approval = asyncio.get_running_loop().create_future()
    candidate.orchestrator.pending_approvals["tool"] = approval
    title_release.set()
    await candidate.title_task
    await asyncio.sleep(0)
    assert jobs.active_count == 1
    with pytest.raises(ChatCapacityError):
        job(jobs).start(asyncio.sleep(0))
    approval.set_result(True)
    await asyncio.sleep(0)
    assert jobs.active_count == 0
    await jobs.shutdown()


@pytest.mark.asyncio
async def test_disconnect_reconnect_reuses_work_and_releases_only_controller():
    jobs = manager()
    candidate = job(jobs)
    token = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, token)
    started = candidate.start(asyncio.sleep(30))
    await asyncio.sleep(0)
    await jobs.detach(candidate.chat_id, candidate, token)
    assert jobs.controller_count == 0 and jobs.active_count == 1 and not started.done()
    reconnect = jobs.admit_controller("a")
    assert jobs.get_or_create(candidate.chat_id, SimpleNamespace(), user_id="a") is candidate
    jobs.attach(candidate.chat_id, candidate, reconnect)
    candidate.start_title_generation()
    assert jobs.active_count == 1
    with pytest.raises(RuntimeError, match="already active"):
        candidate.start(asyncio.sleep(0))
    with pytest.raises(CodedException) as denied:
        jobs.get_or_create(candidate.chat_id, SimpleNamespace(), user_id="b")
    assert denied.value.code == 404
    await jobs.retire(candidate.chat_id)
    assert jobs.active_count == 0
    reconnect.release()
    assert jobs.controller_count == 0


@pytest.mark.asyncio
async def test_controller_accept_failure_releases_admission_and_job():
    jobs = manager()
    candidate = job(jobs)
    connection = SimpleNamespace(accept=AsyncMock(side_effect=RuntimeError("accept failed")), send_json=AsyncMock())
    controller = ChatController(candidate.chat_id, connection, candidate, jobs.admit_controller("a"))
    await controller.run()
    assert jobs.count == jobs.active_count == jobs.controller_count == 0


@pytest.mark.asyncio
async def test_saturated_command_can_retry_on_same_controller():
    jobs = manager()
    occupied = job(jobs)
    running = occupied.start(asyncio.sleep(30))
    await asyncio.sleep(0)
    resume = AsyncMock()
    candidate = job(jobs, resume_pending_turn=resume)
    token = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, token)
    connection = SimpleNamespace(send_json=AsyncMock())
    controller = ChatController(candidate.chat_id, connection, candidate, token)
    controller._is_running = True
    processing = asyncio.create_task(controller._process_commands_loop())
    await controller.inbound_commands.put({"type": "resume"})
    await controller.inbound_commands.join()
    assert connection.send_json.call_args.args[0]["error_code"] == "chat_capacity"
    resume.assert_not_awaited()
    occupied.cancel()
    await running
    await controller.inbound_commands.put({"type": "resume"})
    await controller.inbound_commands.join()
    resume.assert_awaited_once()
    processing.cancel()
    await asyncio.gather(processing, return_exceptions=True)
    await jobs.shutdown()


@pytest.mark.asyncio
async def test_websocket_overload_precedes_history_agent_and_queue_allocation(monkeypatch):
    import asterism.domains.chat.router as router

    jobs = ChatJobManager(ChatCapacityLimits(1, 1, 1, 1))
    jobs.admit_controller("a")
    monkeypatch.setattr(router, "chat_jobs", jobs)
    monkeypatch.setattr(router, "verify_jwks_token", lambda _: SimpleNamespace(id="a"))
    load = AsyncMock()
    agent = Mock()
    monkeypatch.setattr(router.chat_service, "get_one", load)
    monkeypatch.setattr(router, "Agent", agent)
    websocket = SimpleNamespace(accept=AsyncMock(), send_json=AsyncMock(), close=AsyncMock())
    baseline = message_queue_count()
    await router.chat(websocket, uuid.uuid4(), "token")
    load.assert_not_awaited()
    agent.assert_not_called()
    assert jobs.count == 0 and message_queue_count() == baseline
    websocket.accept.assert_awaited_once()
    assert websocket.send_json.call_args.args[0]["retryable"] is True
    assert websocket.close.call_args.kwargs["code"] == 1013
    await jobs.shutdown()


@pytest.mark.asyncio
async def test_websocket_load_failure_releases_reserved_controller(monkeypatch):
    import asterism.domains.chat.router as router

    jobs = manager()
    monkeypatch.setattr(router, "chat_jobs", jobs)
    monkeypatch.setattr(router, "verify_jwks_token", lambda _: SimpleNamespace(id="a"))
    session = AsyncMock()
    monkeypatch.setattr(router.db_session_manager, "session", lambda: session)
    monkeypatch.setattr(router.chat_service, "get_one", AsyncMock(side_effect=CodedException(404, "missing")))
    with pytest.raises(CodedException):
        await router.chat(SimpleNamespace(), uuid.uuid4(), "token")
    assert jobs.controller_count == jobs.count == 0


@pytest.mark.asyncio
async def test_shutdown_holds_capacity_through_cancellation_cleanup():
    jobs = manager()
    candidate = job(jobs)
    token = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, token)
    cleanup_started, cleanup_release = asyncio.Event(), asyncio.Event()

    async def cleanup():
        cleanup_started.set()
        await cleanup_release.wait()

    candidate.orchestrator.cancel_active_generation = cleanup
    candidate.start(asyncio.sleep(30))
    await asyncio.sleep(0)
    stopping = asyncio.create_task(jobs.shutdown())
    await cleanup_started.wait()
    assert jobs.active_count == 1 and jobs.controller_count == 1
    with pytest.raises(ChatCapacityError):
        jobs.admit_controller("b")
    cleanup_release.set()
    await stopping
    assert jobs.active_count == jobs.controller_count == jobs.count == 0


@pytest.mark.asyncio
async def test_title_failure_and_pending_approval_shutdown_release_capacity():
    jobs = manager()
    candidate = job(jobs)
    token = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, token)
    candidate.orchestrator.generate_chat_title = AsyncMock(side_effect=RuntimeError("title provider failed"))
    task = candidate.start_title_generation()
    await asyncio.gather(task, return_exceptions=True)
    await asyncio.sleep(0)
    assert jobs.active_count == 0
    approval = asyncio.get_running_loop().create_future()
    candidate.orchestrator.pending_approvals["tool"] = approval
    await candidate.start(asyncio.sleep(0))
    assert jobs.active_count == 1
    await jobs.shutdown()
    assert approval.cancelled() and jobs.active_count == jobs.controller_count == 0


@pytest.mark.asyncio
async def test_controller_admission_cannot_cross_owner_or_be_attached_twice():
    jobs = manager()
    candidate = job(jobs)
    foreign = jobs.admit_controller("b")
    with pytest.raises(RuntimeError, match="Invalid"):
        jobs.attach(candidate.chat_id, candidate, foreign)
    own = jobs.admit_controller("a")
    jobs.attach(candidate.chat_id, candidate, own)
    with pytest.raises(RuntimeError, match="Invalid"):
        jobs.attach(candidate.chat_id, candidate, own)
    assert candidate.controllers == 1
    own.release()
    with pytest.raises(RuntimeError, match="Invalid"):
        jobs.attach(candidate.chat_id, candidate, own)
    assert candidate.controllers == 0
    await jobs.shutdown()
