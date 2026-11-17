"""US-77.4: keyed job cleanup, background failures and shutdown ordering."""

import asyncio
import logging

import pytest
from asterism.common.job_queue import JobManager
from asterism.core.events import EventBus, EventType, NoArgEvent
from asterism.core.tasks import BackgroundTaskManager


@pytest.mark.asyncio
async def test_re_enqueue_right_after_completion_keeps_the_new_job():
    manager = JobManager(max_concurrency=2)
    release = asyncio.Event()
    replacement: list[bool] = []

    async def second():
        await release.wait()

    async def first():
        # Runs after this task is done but before its done callback: the window
        # where the old callback used to drop the new job's key.
        asyncio.get_running_loop().call_soon(lambda: replacement.append(manager.enqueue("k", second)))

    assert manager.enqueue("k", first)
    first_task = manager._tasks["k"]
    await first_task
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert replacement == [True]
    current = manager._tasks.get("k")
    assert current is not None and current is not first_task and not current.done()
    # The running replacement still deduplicates its key.
    assert not manager.enqueue("k", second)
    release.set()
    await current
    await asyncio.sleep(0)
    assert "k" not in manager._tasks


@pytest.mark.asyncio
async def test_failed_background_work_is_logged(caplog):
    async def boom():
        raise RuntimeError("job exploded")

    manager, tasks = JobManager(max_concurrency=1), BackgroundTaskManager()
    with caplog.at_level(logging.ERROR):
        manager.enqueue("failing", boom)
        spawned = tasks.spawn(boom())
        await asyncio.gather(manager._tasks["failing"], spawned, return_exceptions=True)
        await asyncio.sleep(0)
    failures = [record for record in caplog.records if "failed" in record.getMessage()]
    assert len(failures) == 2
    assert all(isinstance(record.exc_info[1], RuntimeError) for record in failures if record.exc_info)
    assert not tasks.tasks


@pytest.mark.asyncio
async def test_system_stop_handlers_run_to_completion_during_shutdown():
    bus = EventBus()
    finished = asyncio.Event()

    @bus.on(EventType.SYSTEM_STOP)
    async def flush(_event):
        await asyncio.sleep(0.01)  # Real work, such as flushing state.
        finished.set()

    # The lifespan order: emit SYSTEM_STOP, then shut the bus down.
    bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))
    await bus.shutdown(timeout=1)
    assert finished.is_set()
    assert bus.pending_task_count == 0
    # Nothing is dispatched after shutdown.
    bus.emit(NoArgEvent(type=EventType.SYSTEM_STOP))
    assert bus.pending_task_count == 0
