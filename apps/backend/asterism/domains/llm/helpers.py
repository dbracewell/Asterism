"""Conversion helpers between normalized LLM types and provider wire shapes."""

from __future__ import annotations

from typing import Any, Type

from pydantic import BaseModel

from .schemas import LLMMessage


def format_messages_for_model(
    messages: list[LLMMessage],
    response_model: Type[BaseModel] | None = None,
) -> list[dict[str, Any]]:
    """Map normalized messages to provider API dicts.

    Args:
        messages: Conversation in normalized form (copied by the caller; this
            function does not mutate them).
        response_model: Accepted for signature compatibility but currently
            unused — response formatting is handled on the request-payload side
            (``LLMClient._prepare_completion_params``), not per message.
    """
    return [msg.to_api_message() for msg in messages]
