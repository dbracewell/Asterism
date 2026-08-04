from typing import Callable, Sequence


def search[T](
    items: Sequence[T],
    match: Callable[[T], bool],
    reverse: bool = False,
) -> T | None:
    seq = items if not reverse else reversed(items)
    for item in seq:
        if match(item):
            return item
    return None


def index_of[T](
    items: Sequence[T],
    match: Callable[[T], bool],
    reverse: bool = False,
) -> int:
    start = 0
    stop = len(items)
    step = 1
    if reverse:
        start = len(items) - 1
        stop = -1
        step = -1
    for i in range(start, stop, step):
        item = items[i]
        if match(item):
            return i
    return -1
