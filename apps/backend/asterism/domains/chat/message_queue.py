import asyncio
import uuid
from typing import Any

from asterism.common.cache import SlidingTTLCache

MAX_QUEUED_PACKETS = 256
QUEUE_CACHE_MAXSIZE = 1_000
QUEUE_CACHE_TTL_SECONDS = 300


class MessageQueue(asyncio.Queue[dict[str, Any]]):
    """A per-chat outbound queue that retains the newest packets under pressure."""

    dropped_packets: int

    def __init__(self) -> None:
        super().__init__(maxsize=MAX_QUEUED_PACKETS)
        self.dropped_packets = 0

    async def put(self, item: dict[str, Any]) -> None:
        self.put_nowait(item)

    def put_nowait(self, item: dict[str, Any]) -> None:
        if self.full():
            self.get_nowait()
            self.task_done()
            self.dropped_packets += 1
        super().put_nowait(item)


_queue_cache: SlidingTTLCache[uuid.UUID, MessageQueue] = SlidingTTLCache[
    uuid.UUID, MessageQueue
](maxsize=QUEUE_CACHE_MAXSIZE, ttl=QUEUE_CACHE_TTL_SECONDS)


def get_message_queue(chat_id: uuid.UUID) -> MessageQueue:
    queue = _queue_cache.get(chat_id)
    if queue is not None:
        return queue
    queue = MessageQueue()
    _queue_cache[chat_id] = queue
    return queue


def discard_message_queue(chat_id: uuid.UUID) -> None:
    """Eagerly release a retired chat's packets and cache entry."""
    queue = _queue_cache.pop(chat_id, None)
    if queue is None:
        return
    while not queue.empty():
        queue.get_nowait()
        queue.task_done()


def message_queue_count() -> int:
    """Safe aggregate diagnostic for lifecycle tests and operators."""
    _queue_cache.expire()
    return len(_queue_cache)
