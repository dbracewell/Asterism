from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from asterism.core.llm.tool_registory import ToolCall


class LLMEventType(StrEnum):
    TEXT_DELTA = "TEXT_DELTA"
    THINKING_DELTA = "THINKING_DELTA"
    THINKING_COMPLETE = "THINKING_COMPLETE"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"
    PARSE_ERROR = "PARSE_ERROR"


@dataclass
class LLMEvent[T_co]:
    type: LLMEventType
    content: str | None = field(default=None)
    finish_reason: str | None = field(default=None)
    exception: Exception | None = field(default=None)
    total_tokens: int | None = field(default=None)
    parsed: T_co | None = field(default=None)
    tool_calls: list[ToolCall] | None = field(default=None)

    @classmethod
    def empty(cls) -> LLMEvent[T_co]:
        return LLMEvent(type=LLMEventType.COMPLETE)

    def to_dict(self) -> dict[str, Any]:
        tool_calls = []
        for tc in self.tool_calls or []:
            tool_calls.append(tc.model_dump(mode="json"))
        return {
            "type": self.type.value,
            "content": self.content,
            "finish_reason": self.finish_reason,
            "exception": str(self.exception) if self.exception else None,
            "total_tokens": self.total_tokens,
            "parsed": self.parsed.model_dump(mode="json") if self.parsed else None,
            "tool_calls": tool_calls if self.tool_calls else None,
        }
