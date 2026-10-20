from collections.abc import Coroutine
from typing import Any


async def safe_async_call[T](
    func: Coroutine[Any, Any, T],
) -> T | Exception:
    """Await a coroutine and capture its result instead of propagating failures.

    Args:
        func: The coroutine to await (e.g., ``some_coroutine()``).

    Returns:
        The coroutine's result, or the Exception instance if it raised one.
        Callers distinguish success from failure by checking whether the
        returned value is an ``Exception``.
    """
    try:
        return await func
    except Exception as e:
        return e
