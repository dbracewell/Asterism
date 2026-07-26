from enum import StrEnum
from functools import wraps
from typing import Any, Awaitable, Callable, Coroutine, Protocol

from pydantic import BaseModel, Field


class EventType(StrEnum):
    SYSTEM_START = "system_start"
    SYSTEM_STOP = "system_stop"
    TOOL_CREATED = "tool_created"
    TOOL_UPDATED = "tool_updated"
    TOOL_DELETED = "tool_deleted"


class Event(BaseModel):
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)


type EventHandler = Callable[[Event], Coroutine[Awaitable[None], None, None]]
