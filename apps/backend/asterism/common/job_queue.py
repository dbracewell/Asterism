"""Keyed async job queue with bounded concurrency and per-key deduplication."""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any

from asterism.common.log import get_logger

logger = get_logger("JobManager")


def log_task_failure(task: asyncio.Task[Any], name: str) -> None:
    """Retrieve a finished task's exception so it is logged, never left unobserved."""
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        logger.error("Background task %s failed", name, exc_info=error)


class JobManager[**P]:
    """Manage background asyncio jobs keyed by a unique string.

    Jobs are de-duplicated by key: enqueueing while a job with the same key is
    still active (queued or executing) is rejected. At most ``max_concurrency``
    jobs execute at any time; additional queued jobs wait on an internal semaphore.
    Completed and cancelled jobs remove themselves from the registry.
    """

    def __init__(self, max_concurrency: int) -> None:
        """Create a manager allowing up to *max_concurrency* concurrently executing jobs."""
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._running = 0

    @property
    def running(self) -> int:
        """Jobs executing now (holding a concurrency slot)."""
        return self._running

    @property
    def queued(self) -> int:
        """Jobs scheduled but still waiting for a slot."""
        return sum(1 for task in self._tasks.values() if not task.done()) - self._running

    def enqueue(
        self,
        key: str,
        runnable: Callable[P, Coroutine[Any, Any, None]],
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> bool:
        """Schedule an async callable under *key*.

        Args:
            key: Unique identifier for this job; while a job with this key is active, new enqueues are rejected.
            runnable: The coroutine function to run (returns nothing).
            *args, **kwargs: Positional/keyword arguments forwarded to *runnable*.

        Returns:
            True if the job was scheduled, False if a job with this key is already active.
        """
        job = self._tasks.get(key, None)
        if job is not None and job.done():
            self._tasks.pop(key, None)
        elif job is not None:
            return False

        # Runs the job while holding a semaphore slot, so queued jobs count toward max_concurrency only once executing.
        async def _wrapper(
            semaphore: asyncio.Semaphore,
            runnable: Callable[P, Coroutine[Any, Any, None]],
            *args: P.args,
            **kwargs: P.kwargs,
        ) -> None:
            async with semaphore:
                self._running += 1
                try:
                    await runnable(*args, **kwargs)
                finally:
                    self._running -= 1

        task = asyncio.create_task(_wrapper(self._semaphore, runnable, *args, **kwargs))
        self._tasks[key] = task
        task.add_done_callback(lambda finished: self._finished(key, finished))
        return True

    def _finished(self, key: str, task: asyncio.Task[None]) -> None:
        """Drop the key when its task ends, unless a newer job already reuses it (US-77.4)."""
        if self._tasks.get(key) is task:
            del self._tasks[key]
        log_task_failure(task, key)

    def cancel_task(self, key: str) -> bool:
        """Cancel an active job by key (fire-and-forget; does not wait for completion).

        Args:
            key: The job key passed to enqueue.

        Returns:
            True if a matching active job was cancelled, False otherwise.
        """
        task = self._tasks.get(key)
        if task is None:
            return False
        task.cancel()
        return True

    async def cancel_and_wait(self, key: str) -> None:
        """Cancel an active job and await its completion, swallowing any exception it raises.

        Args:
            key: The job key passed to enqueue; a missing key is a no-op.
        """
        task = self._tasks.get(key)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def shutdown(self) -> None:
        """Cancel every active job and wait until all of them have finished."""
        for task in self._tasks.values():
            task.cancel()
        if self._tasks:
            await asyncio.gather(
                *self._tasks.values(),
                return_exceptions=True,
            )
        self._tasks.clear()
