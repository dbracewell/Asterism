from typing import Any, Coroutine


async def safe_async_call[T](
    func: Coroutine[Any, Any, T],
) -> T | Exception:
    try:
        return await func
    except Exception as e:
        return e
