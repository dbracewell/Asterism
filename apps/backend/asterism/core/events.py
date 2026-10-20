"""In-process event bus and frontend webhook delivery.

Producers emit typed :class:`Event` objects on the process-wide ``event_bus``;
registered handlers run as tracked background tasks, and ``WEBHOOK_*`` events
are additionally pushed to the frontend's stream endpoint so connected clients
receive real-time updates.
"""

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

# Upper bound on concurrently tracked dispatch tasks; beyond this, new dispatches are dropped and counted.
MAX_EVENT_HANDLER_TASKS = 100


class EventType(StrEnum):
    """Well-known event names understood by the bus and the frontend."""

    SYSTEM_START = "system_start"
    SYSTEM_STOP = "system_stop"
    DRAFT_MODEL_UPDATED = "draft_model_updated"
    WEBHOOK_CHAT_UPDATE = "chat-session:update"


@dataclass
class Event[T: BaseModel]:
    """A typed event dispatched on the bus.

    Attributes:
        type: The event kind; ``WEBHOOK_*`` kinds are also pushed to the frontend.
        payload: A pydantic model carrying the event data.
        user_id: The user the event is addressed to, if any (used for webhook routing).
    """

    type: EventType
    payload: T
    user_id: str | None = None


@dataclass
class NoArgEvent(Event[NoArgs]):
    """An :class:`Event` with an empty payload, for lifecycle-style notifications."""

    type: EventType
    payload: NoArgs = field(default_factory=NoArgs)
    user_id: str | None = None


type EventHandler[T: BaseModel] = Callable[[Event[T]], Coroutine[Any, Any, None]]


class ChatUpdateEvent(BaseModel):
    """Payload describing a chat session update pushed to connected frontend clients."""

    model_config = ConfigDict(from_attributes=True)
    session_id: uuid.UUID
    title: str | None = None
    project_id: uuid.UUID | None = None


def post_webhook(
    event_type: str,
    payload: dict[str, Any],
    user_id: str | None = None,
) -> None:
    """Blocking delivery of an event to the frontend stream endpoint.

    Use only outside a running event loop; prefer :func:`post_webhook_async` in async code.

    Args:
        event_type: The event type string sent as ``type`` in the webhook body.
        payload: JSON-serializable event data sent as ``payload``.
        user_id: The ID of the user associated with the event, if any.

    Raises:
        requests.HTTPError: If the frontend responds with a non-2xx status.
    """
    response = requests.post(
        url=f"{config.frontend_internal_url}/api/stream",
        headers={"x-asterism-system-key": config.system_key},
        json={
            "type": event_type,
            "payload": payload,
            "userId": user_id,
        },
        timeout=5.0,
    )
    response.raise_for_status()


async def post_webhook_async(
    event_type: str,
    payload: dict[str, Any],
    user_id: str | None = None,
) -> None:
    """Asynchronously post a webhook to the frontend with a non-blocking HTTP client.

    Args:
        event_type: The event type string sent as ``type`` in the webhook body.
        payload: JSON-serializable event data sent as ``payload``.
        user_id: The ID of the user associated with the event, if any.

    Raises:
        httpx.HTTPStatusError: If the frontend responds with a non-2xx status.
    """
    import httpx

    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
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

    def __init__(self) -> None:
        self.logger = get_logger("EventBus")
        # Guards handler registration; dispatch reads the registry unlocked because handlers
        # are registered at import time, before any events are emitted.
        self.lock = threading.Lock()
        self.handlers: dict[EventType, dict[str, EventHandler]] = defaultdict(dict)
        self._tasks: set[asyncio.Task[Any]] = set()
        # Number of dispatches dropped because the task capacity was exhausted or the bus is shutting down.
        self.dropped_handler_dispatches = 0
        self._shutting_down = False

    @property
    def pending_task_count(self) -> int:
        """Number of handler/webhook tasks currently in flight."""
        return len(self._tasks)

    def on[T: BaseModel](
        self,
        event_type: EventType,
    ) -> Callable[[EventHandler[T]], EventHandler[T]]:
        """Decorator registering a coroutine handler for *event_type*.

        Handlers are keyed by ``module::qualname``. Re-registering the same
        function object is idempotent; registering a *different* function under
        an already-used key raises at registration time (i.e., import time)
        instead of silently replacing the existing handler.
        """

        def decorator(func: EventHandler[T]) -> EventHandler[T]:
            with self.lock:
                key = f"{func.__module__}::{func.__qualname__}"  # type:ignore
                existing = self.handlers[event_type].get(key)
                if existing is not None and existing is not func:
                    raise RuntimeError(
                        f"Duplicate event handler for {event_type.value}: {key!r} "
                        "is already registered by a different function",
                    )
                self.handlers[event_type][key] = func
            return func

        return decorator

    def _spawn_task(
        self,
        factory: Callable[[], Coroutine[Any, Any, Any]],
        name: str = "task",
    ) -> None:
        """Run *factory* as a tracked background task, dropping it when at capacity or shutting down.

        Args:
            factory: Zero-argument callable returning the coroutine to run.
            name: Label used in drop/failure log messages.
        """
        if self._shutting_down or len(self._tasks) >= MAX_EVENT_HANDLER_TASKS:
            self.dropped_handler_dispatches += 1
            self.logger.warning("Event dispatch dropped due to lifecycle capacity: %s", name)
            return

        async def run() -> None:
            try:
                await factory()
            except asyncio.CancelledError:
                raise
            except Exception:
                self.logger.exception("Event dispatch failed: %s", name)

        task = asyncio.create_task(run())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _spawn[T: BaseModel](self, handler: EventHandler[T], event: Event[T]) -> None:
        self._spawn_task(lambda: handler(event), name=f"handler::{event.type.name}")

    def emit[T: BaseModel](self, event: Event[T]) -> None:
        """Dispatch *event* to all registered handlers and, for ``WEBHOOK_*`` types, the frontend.

        Handler invocation is fire-and-forget (tracked as background tasks); failures are
        logged, not raised. Webhook delivery falls back to a blocking request when no
        event loop is running (e.g., during script execution).

        Args:
            event: The event to dispatch; its payload must be non-None for ``WEBHOOK_*`` types.

        Raises:
            ValueError: If a ``WEBHOOK_*`` event has no payload.
        """
        if event.type.name.startswith("WEBHOOK_"):
            if event.payload is None:
                raise ValueError("Websockets require a payload")
            payload = event.payload.model_dump(mode="json")
            user_id = event.user_id
            event_type = event.type.value
            try:
                asyncio.get_running_loop()
                self._spawn_task(
                    lambda: post_webhook_async(
                        event_type=event_type,
                        payload=payload,
                        user_id=user_id,
                    ),
                    name=f"webhook::{event_type}",
                )
            except RuntimeError:
                try:
                    post_webhook(
                        event_type=event_type,
                        payload=payload,
                        user_id=user_id,
                    )
                except Exception as error:
                    self.logger.error("Event webhook delivery failed: %s", error)

        for handler in self.handlers[event.type].values():
            self._spawn(handler, event)

    async def shutdown(self) -> None:
        """Stop accepting new dispatches, cancel in-flight tasks, and wait for them to finish."""
        self._shutting_down = True
        tasks = list(self._tasks)
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()


# Process-wide bus instance shared by all domains.
event_bus: EventBus = EventBus()
