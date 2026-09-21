from collections.abc import Coroutine
from typing import Any


async def safe_async_call[T](
    func: Coroutine[Any, Any, T],
) -> T | Exception:
    """
    Safely call an asynchronous function and return its result or any exception that occurs.

    args:
        func: The asynchronous function to call.
    """
    try:
        return await func
    except Exception as e:
        return e
