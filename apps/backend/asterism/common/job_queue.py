"""Keyed async job queue with bounded concurrency and per-key deduplication."""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any


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
                await runnable(*args, **kwargs)

        task = asyncio.create_task(_wrapper(self._semaphore, runnable, *args, **kwargs))
        self._tasks[key] = task
        # Self-cleanup: drop the key when the task finishes or is cancelled.
        task.add_done_callback(lambda _: self._tasks.pop(key, None))
        return True

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
