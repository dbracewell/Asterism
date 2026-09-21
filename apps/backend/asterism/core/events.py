import asyncio
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable, Coroutine

import requests
from pydantic import BaseModel, ConfigDict

from asterism.common.log import get_logger
from asterism.core.schemas import NoArgs

from .config import config

MAX_EVENT_HANDLER_TASKS = 100


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
    """
    Post a webhook to the frontend.

    args:
        event_type: The type of the event.
        payload: The payload of the event.
        user_id: The ID of the user associated with the event, if any.
    """
    response = requests.post(
        url=f"{config.frontend_internal_url}/api/stream",
        headers={"x-asterism-system-key": config.system_key},
        json={
            "type": event_type,
            "payload": payload,
            "userId": user_id,
        },
    )
    response.raise_for_status()


class EventBus:
    """Finite static handler registry with bounded, tracked dispatch work."""

    def __init__(self):
        self.logger = get_logger("EventBus")
        self.lock = threading.Lock()
        self.handlers: dict[EventType, dict[str, EventHandler]] = defaultdict(dict)
        self._tasks: set[asyncio.Task[Any]] = set()
        self.dropped_handler_dispatches = 0
        self._shutting_down = False

    @property
    def pending_task_count(self) -> int:
        return len(self._tasks)

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

    def _spawn[T: BaseModel](self, handler: EventHandler[T], event: Event[T]) -> None:
        if self._shutting_down or len(self._tasks) >= MAX_EVENT_HANDLER_TASKS:
            self.dropped_handler_dispatches += 1
            self.logger.warning("Event handler dispatch dropped due to lifecycle capacity")
            return

        async def run() -> None:
            try:
                await handler(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                # Event payloads can contain user data; never include an
                # exception string or event in this process-lifetime log.
                self.logger.exception("Event handler failed")

        task = asyncio.create_task(run())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

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
            except Exception as error:
                self.logger.error("Event webhook delivery failed: %s", error)

        for handler in self.handlers[event.type].values():
            self._spawn(handler, event)

    async def shutdown(self) -> None:
        self._shutting_down = True
        tasks = list(self._tasks)
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()


event_bus: EventBus = EventBus()
