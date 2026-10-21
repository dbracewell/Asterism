"""Shared type aliases for the LLM domain."""

from typing import Literal

# Provider-reported reason a completion stopped. Mirrors OpenAI's finish_reason
# values; local servers frequently report ``None`` instead, so consumers must not
# rely on this being set (see Agent.run's "no tool calls => final" rule).
type FinishReason = Literal[
    "stop",
    "length",
    "tool_calls",
    "content_filter",
    "function_call",
]
