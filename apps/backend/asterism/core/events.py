import asyncio
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable, Coroutine

import requests
from pydantic import BaseModel, ConfigDict

from asterism.common.concurrency import suppress_exceptions
from asterism.common.log import get_logger
from asterism.core.schemas import NoArgs

from .config import config


class EventType(StrEnum):
    SYSTEM_START = "system_start"
    SYSTEM_STOP = "system_stop"
    TOOL_CREATED = "tool_created"
    TOOL_UPDATED = "tool_updated"
    TOOL_DELETED = "tool_deleted"
    DRAFT_MODEL_UPDATED = "draft_model_updated"
    USER_SETTING_UPDATED = "user_setting_updated"
    WEBHOOK_CHAT_UPDATE = "chat-session:update"


@dataclass
class Event[T: BaseModel]:
    type: EventType
    payload: T
    user_id: str | None = None


@dataclass
class NoArgEvent(Event[NoArgs]):
    type: EventType
    payload: NoArgs = field(default_factory=NoArgs)
    user_id: str | None = None


type EventHandler[T: BaseModel] = Callable[[Event[T]], Coroutine[Any, Any, None]]


class ChatUpdateEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    session_id: uuid.UUID
    title: str | None = None
    folder_id: uuid.UUID | None = None


def post_webhook(
    event_type: str,
    payload: dict[str, Any],
    user_id: str | None = None,
) -> None:
    response = requests.post(
        url=f"{config.frontend_url}/api/stream",
        headers={"x-asterism-system-key": config.system_key},
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
        self.handlers: dict[EventType, dict[str, EventHandler]] = defaultdict(dict)

    def on[T: BaseModel](
        self,
        event_type: EventType,
    ) -> Callable[[EventHandler[T]], EventHandler[T]]:
        def decorator(func: EventHandler[T]) -> EventHandler[T]:
            with self.lock:
                key = f"{func.__module__}::{func.__name__}"  # type:ignore
                self.handlers[event_type][key] = func
            return func

        return decorator

    def emit[T: BaseModel](self, event: Event[T]) -> None:
        if event.type.name.startswith("WEBHOOK_"):
            if event.payload is None:
                raise ValueError("Websockets require a payload")
            try:
                post_webhook(
                    event_type=event.type.value,
                    payload=event.payload.model_dump(mode="json"),
                    user_id=event.user_id,
                )
            except Exception as e:
                self.logger.error(e)

        for handler in self.handlers[event.type].values():
            asyncio.create_task(suppress_exceptions(handler, event))


event_bus: EventBus = EventBus()
