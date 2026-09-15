import asyncio
import uuid
from typing import Any

from asterism.common.cache import SlidingTTLCache

type MessageQueue = asyncio.Queue[dict[str, Any]]


_queue_cache: SlidingTTLCache[uuid.UUID, MessageQueue] = SlidingTTLCache[
    uuid.UUID, MessageQueue
](maxsize=100000, ttl=86400)


def get_message_queue(chat_id: uuid.UUID) -> MessageQueue:
    queue = _queue_cache.get(chat_id)
    if queue:
        return queue
    queue = asyncio.Queue[dict[str, Any]]()
    _queue_cache[chat_id] = queue
    return queue
