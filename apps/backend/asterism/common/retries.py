"""Retry decorators for async functions and async generators."""

import asyncio
import functools
from collections.abc import AsyncGenerator
from typing import Callable, Type


def async_retry[T](
    on_exceed_attempts: Callable[[BaseException], T],
    no_retry: tuple[Type[Exception]] | None = None,
    max_retries=3,
    delay_base=2,
):
    """Decorator that retries a coroutine function with exponential backoff.

    Args:
        on_exceed_attempts: Called with the fatal exception when retries are exhausted or a no-retry
            exception occurs; its return value is passed through to the caller.
        no_retry: Exception types that must never be retried; they immediately trigger *on_exceed_attempts*.
        max_retries: Number of retries after the initial attempt (total attempts = max_retries + 1).
        delay_base: Base for exponential backoff; the sleep before retry n is ``delay_base ** n`` seconds.

    Returns:
        A decorator that wraps an async function with retry behavior. On success it
        returns the wrapped function's result; on failure it returns whatever
        *on_exceed_attempts* produced, so callers can distinguish outcomes from the return value.
    """
    must_raise = no_retry or ()

    def decorator(func):

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Placeholder in case the loop somehow exits without a recorded exception.
            last_exception: Exception = ValueError("No exception raised during retries, but exceeded max retries.")

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except must_raise as me:
                    # Non-retryable failure: hand off immediately.
                    return on_exceed_attempts(me)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries:
                        await asyncio.sleep(delay_base**attempt)

            return on_exceed_attempts(last_exception)

        return wrapper

    return decorator


type ExceptionTypes = tuple[type[Exception], ...] | type[Exception]


def retry_async_gen[**P, T, X](
    on_exceed_attempts: Callable[[BaseException], T],
    no_retry: ExceptionTypes | None = None,
    max_retries=3,
    delay_base=2.0,
) -> Callable[
    [Callable[P, AsyncGenerator[X, None]]],
    Callable[P, AsyncGenerator[X | T, None]],
]:
    """Decorator that retries an async generator function with exponential backoff.

    Unlike :func:`async_retry`, a generator can only be restarted safely before it
    has yielded anything: once items have been emitted, retrying would duplicate them,
    so the fallback value from *on_exceed_attempts* is yielded instead of retrying.

    Args:
        on_exceed_attempts: Called with the fatal exception when retries are exhausted or a no-retry
            exception occurs; its return value is yielded to the consumer (and may be None).
        no_retry: Exception types that must never be retried; they immediately trigger *on_exceed_attempts*.
        max_retries: Number of retries after the initial attempt (total attempts = max_retries + 1).
        delay_base: Base for exponential backoff; the sleep before retry n is ``delay_base ** n`` seconds.

    Returns:
        A decorator that wraps an async generator with retry behavior, yielding the
        original items on success and the *on_exceed_attempts* value on failure.
    """
    must_raise = no_retry or ()

    def decorator(
        func: Callable[P, AsyncGenerator[X, None]],
    ) -> Callable[P, AsyncGenerator[X | T, None]]:

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> AsyncGenerator[X | T, None]:
            # Placeholder in case the loop somehow exits without a recorded exception.
            last_exception: Exception = ValueError("No exception raised during retries, but exceeded max retries.")

            for attempt in range(max_retries + 1):
                yielded_any = False
                try:
                    async for item in func(*args, **kwargs):
                        yielded_any = True
                        yield item
                    return
                except must_raise as me:
                    # Non-retryable failure: hand off immediately.
                    yield on_exceed_attempts(me)
                    return
                except Exception as e:
                    last_exception = e
                    if yielded_any:
                        # Items already consumed; restarting would duplicate them, so bail out.
                        yield on_exceed_attempts(e)
                        return
                    if attempt < max_retries:
                        await asyncio.sleep(delay_base**attempt)

            yield on_exceed_attempts(last_exception)

        return wrapper

    return decorator
