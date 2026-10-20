from __future__ import annotations

from typing import Any, Type

from pydantic import BaseModel

from .schemas import LLMMessage


def format_messages_for_model(
    messages: list[LLMMessage],
    response_model: Type[BaseModel] | None = None,
) -> list[dict[str, Any]]:
    return [msg.to_api_message() for msg in messages]
