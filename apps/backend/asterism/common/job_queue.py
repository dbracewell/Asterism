import abc
import asyncio
from collections.abc import Callable, Coroutine
from typing import Any


class JobManager[**P](abc.ABC):
    def __init__(self, max_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(
        self,
        key: str,
        runnable: Callable[P, Coroutine[Any, Any, None]],
        *args: P.args,
        **kwargs: P.kwargs,
    ) -> bool:
        if key in self._tasks:
            return False

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
        task.add_done_callback(lambda _: self._tasks.pop(key, None))
        return True

    def cancel_task(self, key: str) -> bool:
        task = self._tasks.get(key)
        if task is None:
            return False
        task.cancel()
        return True

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        if self._tasks:
            await asyncio.gather(
                *self._tasks.values(),
                return_exceptions=True,
            )
        self._tasks.clear()


class JobQueue[**P](abc.ABC):
    def __init__(self, max_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(self, *args: P.args, **kwargs: P.kwargs) -> bool:
        key = self._make_key(*args, **kwargs)
        if key in self._tasks:
            return False
        task = asyncio.create_task(self._run(*args, **kwargs))
        self._tasks[key] = task
        task.add_done_callback(lambda _: self._tasks.pop(key, None))
        return True

    async def _run(self, *args: P.args, **kwargs: P.kwargs) -> None:
        async with self._semaphore:
            await self._run_impl(*args, **kwargs)

    def cancel(self, key: str) -> bool:
        task = self._tasks.get(key)
        if task is None:
            return False
        task.cancel()
        return True

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        if self._tasks:
            await asyncio.gather(
                *self._tasks.values(),
                return_exceptions=True,
            )
        self._tasks.clear()

    @abc.abstractmethod
    async def recover_interrupted(self) -> None: ...

    @abc.abstractmethod
    def _make_key(self, *args: P.args, **kwargs: P.kwargs) -> str: ...

    @abc.abstractmethod
    async def _run_impl(self, *args: P.args, **kwargs: P.kwargs) -> None: ...
