import asyncio
import threading
from collections import defaultdict
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Awaitable, Callable, Coroutine

import requests
from pydantic import BaseModel

from asterism.core import config
from asterism.core.utils.log import get_logger
from asterism.core.utils.suppress import suppress_exceptions


class EventType(StrEnum):
    SYSTEM_START = "system_start"
    SYSTEM_STOP = "system_stop"
    TOOL_CREATED = "tool_created"
    TOOL_UPDATED = "tool_updated"
    TOOL_DELETED = "tool_deleted"
    DRAFT_MODEL_UPDATED = "draft_model_updated"
    WEBHOOK_CHAT_UPDATE = "chat-session:update"


@dataclass
class Event[T: BaseModel]:
    type: EventType
    payload: T | None = None
    user_id: str | None = None


type EventHandler = Callable[[Event], Coroutine[Awaitable[None], None, None]]


def post_webhook(
    event_type: str,
    payload: dict[str, Any],
    user_id: str | None = None,
) -> None:
    response = requests.post(
        url=f"{config.FRONT_END_URL}/api/stream",
        headers={"x-asterism-system-key": config.SYSTEM_KEY},
        json={
            "type": event_type,
            "payload": payload,
            "userId": user_id,
        },
    )
    response.raise_for_status()


class EventBus:
    def __init__(self):
        self.logger = get_logger("EventBus")
        self.lock = threading.Lock()
        self.handlers: dict[EventType, list[EventHandler]] = defaultdict(
            list[EventHandler]
        )

    def on(self, event_type: EventType, handler: EventHandler) -> None:
        self.lock.acquire()
        self.handlers[event_type].append(handler)
        self.lock.release()

    def emit[T: BaseModel](self, event: Event[T]) -> None:
        if event.type.name.startswith("WEBHOOK_"):
            try:
                post_webhook(
                    event_type=event.type.value,
                    payload=event.payload.model_dump(mode="json"),
                    user_id=event.user_id,
                )
            except Exception as e:
                self.logger.error(e)

        for handler in self.handlers[event.type]:
            asyncio.create_task(suppress_exceptions(handler(event), self.logger))


event_bus: EventBus = EventBus()
