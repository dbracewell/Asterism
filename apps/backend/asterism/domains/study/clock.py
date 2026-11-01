"""The study clock in Unix seconds; one seam so tests can move time."""

import time


def now_seconds() -> int:
    return int(time.time())
