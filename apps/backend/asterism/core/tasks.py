import asyncio
from typing import Any


class BackgroundTaskManager:
    def __init__(self):
        self.tasks: set[asyncio.Task[Any]] = set()

    def spawn(self, coro) -> asyncio.Task[Any]:
        """Spawns a task and tracks it for graceful shutdown."""
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
