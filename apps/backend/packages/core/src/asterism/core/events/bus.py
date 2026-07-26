import asyncio
import threading
import uuid
from collections import defaultdict

from asterism.core.events.typedefs import Event, EventHandler, EventType


class EventBus:
    def __init__(self):
        self._lock = threading.Lock()
        self._handler_ids: dict[str, tuple[EventType, EventHandler]] = {}
        self.handlers: dict[EventType, list[EventHandler]] = defaultdict(
            list[EventHandler]
        )

    def on(self, event_type: EventType, handler: EventHandler) -> str:
        self._lock.acquire()
        handler_id = uuid.uuid4().hex
        self._handler_ids[handler_id] = (event_type, handler)
        self.handlers[event_type].append(handler)
        self._lock.release()
        return handler_id

    def remove(self, handler_id: str) -> None:
        self._lock.acquire()
        result = self._handler_ids.pop(handler_id, None)
        if result:
            event_type, handler = result
            self.handlers[event_type].remove(handler)
        self._lock.release()

    def emit(self, event: Event) -> None:
        for handler in self.handlers[event.type]:
            asyncio.create_task(handler(event))


event_bus: EventBus = EventBus()
