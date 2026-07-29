import asyncio
import functools
from typing import Callable, Type, TypeVar

ReturnType = TypeVar("ReturnType")


def async_retry(
    on_exceed_attempts: Callable[[Exception], ReturnType],
    no_retry: list[Type[Exception]] | None = None,
    on_exceed_throw_exception: bool = True,
    max_retries=3,
    delay_base=2,
):
    def decorator(func):

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    if no_retry is not None:
                        for exception in no_retry:
                            if isinstance(e, exception):
                                if on_exceed_throw_exception:
                                    raise
                                return on_exceed_attempts(e)
                    last_exception = e
                    if attempt < max_retries:
                        await asyncio.sleep(delay_base**attempt)

            if on_exceed_throw_exception:
                raise on_exceed_attempts(last_exception) from last_exception  # type: ignore
            return on_exceed_attempts(last_exception)  # type: ignore

        return wrapper

    return decorator


def retry_async_gen(
    on_exceed_attempts: Callable[[Exception], ReturnType],
    no_retry: list[Type[Exception]] | None = None,
    max_retries=3,
    delay_base=2.0,
):
    def decorator(func):

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None

            for attempt in range(max_retries + 1):
                try:
                    async for item in func(*args, **kwargs):
                        yield item
                    return
                except Exception as e:
                    last_exception = e
                    if no_retry is not None:
                        for exception in no_retry:
                            if isinstance(e, exception):
                                yield on_exceed_attempts(e)
                                return
                    if attempt < max_retries:
                        await asyncio.sleep(delay_base**attempt)

            yield on_exceed_attempts(last_exception)  # type: ignore

        return wrapper

    return decorator
