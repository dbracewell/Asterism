"""Lightweight tracker for fire-and-forget background tasks with graceful shutdown."""

import asyncio
from collections.abc import Coroutine
from typing import Any


class BackgroundTaskManager:
    """Manages background tasks for graceful shutdown.

    Unlike the keyed :class:`~asterism.common.job_queue.JobManager`, tasks here are
    anonymous: each spawned coroutine is tracked until it completes so shutdown can
    cancel and drain them.
    """

    def __init__(self) -> None:
        self.tasks: set[asyncio.Task[Any]] = set()

    def spawn(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Task[Any]:
        """Start *coro* as a tracked background task.

        Args:
            coro: The coroutine to run; it is scheduled immediately on the running loop.

        Returns:
            The created task (already self-removing from the tracker on completion).
        """
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def shutdown(self) -> None:
        """Cancel and await connection-owned tasks without masking errors."""
        tasks = list(self.tasks)
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
