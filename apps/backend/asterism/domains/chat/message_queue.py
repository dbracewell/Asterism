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

    def drain_into(self, target: "MessageQueue | None") -> int:
        """Move every queued packet to ``target`` (or drop it); returns the count."""
        count = 0
        while not self.empty():
            item = self.get_nowait()
            self.task_done()
            if target is not None:
                target.put_nowait(item)
            count += 1
        return count


class ChatStream(MessageQueue):
    """A chat's outbound packets, broadcast to every attached controller (US-77.3).

    Each controller subscribes with its own bounded queue and receives every
    packet. While none is attached, the stream itself buffers packets (dropping
    the oldest past the bound) and replays them to the first controller that
    subscribes. When the last controller leaves, the packets it had not sent
    yet are buffered again, so a detach and reattach loses nothing within the
    bound.
    """

    def __init__(self) -> None:
        super().__init__()
        self._subscribers: list[MessageQueue] = []

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def put_nowait(self, item: dict[str, Any]) -> None:
        if not self._subscribers:
            super().put_nowait(item)
            return
        for subscriber in self._subscribers:
            subscriber.put_nowait(item)

    def subscribe(self) -> tuple[MessageQueue, int]:
        """A new controller's queue, and how many buffered packets it was given."""
        subscriber = MessageQueue()
        replayed = 0 if self._subscribers else self.drain_into(subscriber)
        self._subscribers.append(subscriber)
        return subscriber, replayed

    def unsubscribe(self, subscriber: MessageQueue) -> None:
        if subscriber not in self._subscribers:
            return
        self._subscribers.remove(subscriber)
        # With no controller left, put_nowait buffers on the stream itself.
        subscriber.drain_into(None if self._subscribers else self)

    def discard(self) -> None:
        for queue in [self, *self._subscribers]:
            queue.drain_into(None)
        self._subscribers.clear()


# Idle streams expire from the cache; a stream with attached controllers is
# pinned so its producers and subscribers always share it.
_queue_cache: SlidingTTLCache[uuid.UUID, ChatStream] = SlidingTTLCache[
    uuid.UUID,
    ChatStream,
](maxsize=QUEUE_CACHE_MAXSIZE, ttl=QUEUE_CACHE_TTL_SECONDS)
_attached: dict[uuid.UUID, ChatStream] = {}


def get_message_queue(chat_id: uuid.UUID) -> ChatStream:
    stream = _attached.get(chat_id) or _queue_cache.get(chat_id)
    if stream is not None:
        return stream
    stream = ChatStream()
    _queue_cache[chat_id] = stream
    return stream


def subscribe(chat_id: uuid.UUID) -> tuple[MessageQueue, int]:
    """Attach a controller to the chat's stream; see :meth:`ChatStream.subscribe`."""
    stream = get_message_queue(chat_id)
    _attached[chat_id] = stream
    _queue_cache.pop(chat_id, None)
    return stream.subscribe()


def unsubscribe(chat_id: uuid.UUID, subscriber: MessageQueue) -> None:
    stream = _attached.get(chat_id)
    if stream is None:
        return
    stream.unsubscribe(subscriber)
    if not stream.subscriber_count:
        _attached.pop(chat_id, None)
        _queue_cache[chat_id] = stream


def discard_message_queue(chat_id: uuid.UUID) -> None:
    """Eagerly release a retired chat's packets and cache entry."""
    for streams in (_attached, _queue_cache):
        stream = streams.pop(chat_id, None)
        if stream is not None:
            stream.discard()


def message_queue_count() -> int:
    """Safe aggregate diagnostic for lifecycle tests and operators."""
    _queue_cache.expire()
    return len(_queue_cache) + len(_attached)
