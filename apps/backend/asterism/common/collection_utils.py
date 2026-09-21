from collections.abc import Iterator, Sequence
from typing import Callable


def search[T](
    items: Sequence[T],
    match: Callable[[T], bool],
    reverse: bool = False,
) -> T | None:
    """
    Search for an item in a sequence that matches a given condition.
    If reverse is True, the search is performed in reverse order.
    Returns the first matching item, or None if no match is found.

    args:
        items: A sequence of items to search through.
        match: A callable that takes an item and returns True if it matches the condition.
        reverse: If True, search the sequence in reverse order.
    """
    seq: Sequence[T] | Iterator[T] = items if not reverse else reversed[T](items)
    return next((item for item in seq if match(item)), None)


def index_of[T](
    items: Sequence[T],
    match: Callable[[T], bool],
    reverse: bool = False,
) -> int:
    """
    Find the index of an item in a sequence that matches a given condition.
    If reverse is True, the search is performed in reverse order.
    Returns the index of the first matching item, or -1 if no match is found.

    args:
        items: A sequence of items to search through.
        match: A callable that takes an item and returns True if it matches the condition.
        reverse: If True, search the sequence in reverse order.
    """
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
