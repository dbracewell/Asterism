import asyncio
import logging
from threading import Lock
from typing import Any, Callable, Coroutine

type Getter[T] = Callable[[], T]
type Setter[T] = Callable[[T], None]


async def safe_async_call[T](
    func: Coroutine[Any, Any, T],
) -> T | Exception:
    try:
        return await func
    except Exception as e:
        return e


async def suppress_exceptions(coro, logger: logging.Logger):
    try:
        return await coro
    except Exception as e:
        logger.error(e, stack_info=True)


class Atomic[T]:
    def __init__(self, initial_value: T) -> None:
        self._value: T = initial_value
        self._lock: Lock = Lock()

    def __enter__(self) -> tuple[Getter[T], Setter[T]]:
        self._lock.acquire()

        def get():
            return self._value

        def set(value: T) -> None:
            self._value = value

        return get, set

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self._lock.release()

    @property
    def value(self) -> T:
        with self._lock:
            return self._value

    @value.setter
    def value(self, value: T) -> None:
        with self._lock:
            self._value = value


class AsyncAtomic[T]:
    def __init__(self, initial_value: T) -> None:
        self._value: T = initial_value
        self._lock: asyncio.Lock = asyncio.Lock()

    async def __aenter__(self) -> tuple[Getter[T], Setter[T]]:
        await self._lock.acquire()

        def get() -> T:
            return self._value

        def set(value: T) -> None:
            self._value = value

        return get, set

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        self._lock.release()

    async def get_value(self) -> T:
        async with self._lock:
            return self._value

    async def set_value(self, value: T) -> None:
        async with self._lock:
            self._value = value
