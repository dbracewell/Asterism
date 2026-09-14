import asyncio


class BackgroundTaskManager:
    def __init__(self):
        self.tasks: set[asyncio.Task] = set()

    def spawn(self, coro) -> asyncio.Task:
        """Spawns a task and tracks it for graceful shutdown."""
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    async def shutdown(self) -> None:
        """Cancels all running tasks."""
        for task in self.tasks:
            if not task.done():
                task.cancel()
