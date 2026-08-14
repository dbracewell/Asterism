import asyncio
import functools
from typing import Callable, Type


def async_retry[T](
    on_exceed_attempts: Callable[[BaseException], T],
    no_retry: tuple[Type[Exception]] | None = None,
    max_retries=3,
    delay_base=2,
):
    must_raise = no_retry or ()

    def decorator(func):

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception: Exception = ValueError(
                "No exception raised during retries, but exceeded max retries."
            )

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except must_raise as me:
                    return on_exceed_attempts(me)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries:
                        await asyncio.sleep(delay_base**attempt)

            return on_exceed_attempts(last_exception)

        return wrapper

    return decorator


def retry_async_gen[T](
    on_exceed_attempts: Callable[[BaseException], T],
    no_retry: tuple[Type[Exception]] | None = None,
    max_retries=3,
    delay_base=2.0,
):
    must_raise = no_retry or ()

    def decorator(func):

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception: Exception = ValueError(
                "No exception raised during retries, but exceeded max retries."
            )

            for attempt in range(max_retries + 1):
                try:
                    async for item in func(*args, **kwargs):
                        yield item
                    return
                except must_raise as me:
                    yield on_exceed_attempts(me)
                    return
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries:
                        await asyncio.sleep(delay_base**attempt)

            yield on_exceed_attempts(last_exception)

        return wrapper

    return decorator
