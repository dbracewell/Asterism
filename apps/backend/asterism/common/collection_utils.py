from collections.abc import Iterator, Sequence
from typing import Callable


def search[T](
    items: Sequence[T],
    match: Callable[[T], bool],
    reverse: bool = False,
) -> T | None:
    seq: Sequence[T] | Iterator[T] = items if not reverse else reversed[T](items)
    return next((item for item in seq if match(item)), None)


def index_of[T](
    items: Sequence[T],
    match: Callable[[T], bool],
    reverse: bool = False,
) -> int:
    start: int = 0
    stop: int = len(items)
    step: int = 1
    if reverse:
        start = len(items) - 1
        stop = -1
        step = -1
    for i in range(start, stop, step):
        item = items[i]
        if match(item):
            return i
    return -1
