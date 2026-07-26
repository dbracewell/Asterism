from __future__ import annotations

from enum import StrEnum, auto


class MessageStatus(StrEnum):
    PENDING = auto()
    COMPLETED = auto()
