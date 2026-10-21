"""Wire and data types shared across the LLM domain.

Defines the normalized chat message shape (``LLMMessage``), the streaming event
types emitted by ``LLMClient.chat`` (``LLMEvent`` / ``LLMEventType``), tool
call/result wire shapes, multimodal content parts, the optional completion
parameters callers may pass through (``ChatCompletionParams``), and the
structural client protocol (``LLMClientProtocol``) that agents and tools depend on.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum, auto
from typing import (
    Annotated,
    Any,
    AsyncGenerator,
    Awaitable,
    Literal,
    NotRequired,
    Optional,
    Protocol,
    Self,
    Sequence,
    Type,
    TypedDict,
    Unpack,
)

from pydantic import BaseModel, ConfigDict, Field


class ChatCompletionParams(TypedDict):
    """Optional OpenAI-compatible chat-completion parameters, all keyword-only.

    Callers pass a subset of these through ``LLMClient.chat/generate(**kwargs)``;
    they are forwarded verbatim to the provider's ``chat.completions.create``.
    All keys are optional (``NotRequired``) so any combination can be unpacked.
    """

    reasoning_effort: NotRequired[Any]
    temperature: NotRequired[float]
    top_p: NotRequired[float]
    frequency_penalty: NotRequired[float]
    presence_penalty: NotRequired[float]
    seed: NotRequired[int]
    stop: NotRequired[str | Sequence[str]]
    extra_body: NotRequired[dict[str, Any]]
    tool_choice: NotRequired[Literal["required", "auto", "none"] | dict[str, Any]]
    max_tokens: NotRequired[int]
    modalities: NotRequired[list[Literal["text", "audio"]]]
    audio: NotRequired[dict[str, Any]]
    prediction: NotRequired[dict[str, Any]]
    parallel_tool_calls: NotRequired[bool]
    n: NotRequired[int]
    logit_bias: NotRequired[dict[str, int]]
    logprobs: NotRequired[bool]
    top_logprobs: NotRequired[int]
    extra_headers: NotRequired[dict[str, str]]
    extra_query: NotRequired[dict[str, Any]]
    timeout: NotRequired[float | None]


class LLMEventType(StrEnum):
    """Kinds of events emitted while streaming a chat completion.

    A ``chat`` stream emits zero or more ``TEXT_DELTA``/``THINKING_DELTA`` events
    while tokens arrive, then exactly one terminal event: ``COMPLETE`` on success
    or ``ERROR`` (empty chunk, provider exception, or response-model validation
    failure). ``START`` is defined for completeness but not currently emitted.
    """

    START = auto()
    COMPLETE = auto()
    TEXT_DELTA = auto()
    THINKING_DELTA = auto()
    ERROR = auto()


@dataclass(frozen=True)
class LLMEvent[T: BaseModel]:
    """One event from an ``LLMClient.chat`` stream (frozen; safe to share/log).

    Fields:
        type: Event kind; determines which other fields are meaningful.
        content: Full accumulated assistant text so far (delta events carry the
            running total, not just the increment).
        thinking: Accumulated reasoning/thinking text (providers that expose it).
        finish_reason: Provider-reported stop reason on the terminal event.
        exception: Set only on ``ERROR`` events; the underlying exception object.
        input_tokens/output_tokens/total_tokens: Provider-reported usage from the
            final chunk (0 when the provider did not report usage).
        generation_duration_ms: Wall-clock duration of the whole stream in ms.
        parsed: On ``COMPLETE``, the validated instance of ``response_model``
            (type ``T``) when one was requested, else ``None``.
        tool_calls: Structured tool calls on ``COMPLETE`` (provider-native or
            recovered from textual fallback).
        tool_result: Reserved for a single tool result; never populated today.
    """

    type: LLMEventType
    content: str = field(default="")
    thinking: str = field(default="")
    finish_reason: Optional[Literal["stop", "length", "tool_calls", "content_filter", "function_call"]] = None
    exception: BaseException | None = field(default=None)
    input_tokens: int = field(default=0)
    output_tokens: int = field(default=0)
    total_tokens: int = field(default=0)
    generation_duration_ms: int = field(default=0)
    parsed: T | None = field(default=None)
    tool_calls: list["ToolCall"] | None = field(default=None)
    tool_result: "ToolResult | None" = field(default=None)

    def to_dict(self) -> dict[str, Any]:
        """Serialize for persistence/WebSocket transport.

        The exception object is reduced to its string form and the ``parsed``
        model is dumped as JSON-compatible data; ``tool_result`` is intentionally
        omitted from the serialized shape.
        """
        tool_calls = []
        for tc in self.tool_calls or []:
            tool_calls.append(tc.model_dump(mode="json"))
        return {
            "type": self.type.value,
            "content": self.content,
            "thinking": self.thinking,
            "finish_reason": self.finish_reason,
            "exception": str(self.exception) if self.exception else None,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "generation_duration_ms": self.generation_duration_ms,
            "parsed": self.parsed.model_dump(mode="json") if self.parsed else None,
            "tool_calls": tool_calls if self.tool_calls else None,
        }


class Function(BaseModel):
    """A named function invocation with its arguments as a JSON *string*.

    Matches the OpenAI wire shape: ``arguments`` is always serialized text that
    callers must ``json.loads`` before use.
    """

    name: str
    arguments: str


class ToolCall(BaseModel):
    """One provider-requested tool invocation (OpenAI-compatible shape).

    The stable ``id`` links the call to its later ``tool``-role result message.
    """

    id: str
    function: Function
    type: Literal["function"] = "function"


@dataclass(frozen=True)
class ArgDesc:
    """Single-field argument description. Currently unused."""

    description: str


@dataclass
class ToolResult:
    """Outcome of executing one tool call, fed back to the model as a ``tool`` message.

    Fields:
        content: Textual result presented to the model (may be an error notice).
        raw_result: Unprocessed return value from the tool implementation.
        is_empty: True when the tool produced no usable output (e.g. rejected).
        tool_call: The originating call, used to bind the result message by id.
    """

    content: str
    raw_result: Any
    is_empty: bool
    tool_call: ToolCall

    def to_dict(self) -> dict[str, Any]:
        """JSON-compatible serialization for persistence and event payloads."""
        return {
            "content": self.content,
            "raw_result": self.raw_result,
            "is_empty": self.is_empty,
            "tool_call": self.tool_call.model_dump(mode="json"),
        }


class TextContentPart(BaseModel):
    """Textual part of a multimodal message."""

    type: Literal["text"] = "text"
    text: str


class ImageUrlContent(BaseModel):
    """Image reference; ``url`` may be an HTTP(S) URL or a data: URI."""

    url: str


class ImageUrlContentPart(BaseModel):
    """Image part of a multimodal message (vision-capable models only)."""

    type: Literal["image_url"] = "image_url"
    image_url: ImageUrlContent


# Discriminated union of the content parts a single message may carry.
ContentPart = Annotated[
    TextContentPart | ImageUrlContentPart,
    Field(discriminator="type"),
]


def text_content(message: "LLMMessage") -> str:
    """Return only textual content for non-multimodal consumers.

    Plain-string messages are returned as-is; multimodal messages yield their
    text parts joined by newlines (image parts are ignored).
    """
    if isinstance(message.content, str):
        return message.content
    return "\n".join(part.text for part in message.content if isinstance(part, TextContentPart))


class LLMMessage(BaseModel):
    """Normalized chat message used across the agent loop and provider calls.

    Fields:
        role: One of ``system``, ``user``, ``assistant``, or ``tool`` (free-form
            string; validated only when mapping to the API shape).
        content: Plain text, or a list of multimodal parts (user messages only).
        thinking: Reasoning/thinking text recorded for assistant turns; not sent
            back to providers.
        tool_calls: On assistant messages, the calls the model requested. On
            ``tool`` messages, repurposed to carry the *single* originating call
            so ``to_api_message`` can emit ``tool_call_id``/``name``.

    Use the classmethods (``user``, ``system``, ``assistant``, ``tool_call_result``)
    rather than constructing directly; they encode the role/content invariants.
    """

    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
    )
    role: str
    content: str | list[ContentPart]
    thinking: str | None = Field(default=None)
    tool_calls: list[ToolCall] | None = Field(default=None)

    def to_api_message(self) -> dict[str, Any]:
        """Map to the provider API wire shape for one message.

        - Multimodal content is only allowed on ``user`` messages.
        - ``tool`` messages must carry exactly one originating call in
          ``tool_calls`` (guaranteed by :meth:`tool_call_result`); raises if empty.
        - Assistant messages omit ``content`` when it is empty so that
          tool-call-only turns serialize correctly.
        """
        if isinstance(self.content, list):
            if self.role != "user":
                raise RuntimeError("Only user messages may use structured content")
            return {
                "role": self.role,
                "content": [part.model_dump(mode="json") for part in self.content],
            }

        if self.role == "tool":
            return {
                "role": self.role,
                "content": self.content,
                "tool_call_id": self.tool_calls[0].id,  # type: ignore
                "name": self.tool_calls[0].function.name,  # type: ignore
            }

        if self.role == "assistant":
            data: dict[str, Any] = {"role": "assistant"}
            if self.content:
                data["content"] = self.content
            if self.tool_calls:
                data["tool_calls"] = [tc.model_dump(mode="json") for tc in self.tool_calls]
            return data

        if not self.content:
            raise RuntimeError(f"Invalid message: {self}")

        return {"role": self.role, "content": self.content}

    @classmethod
    def user(cls, content: str) -> Self:
        """Build a plain-text ``user`` message."""
        return cls(role="user", content=content)

    @classmethod
    def system(cls, content: str) -> Self:
        """Build a plain-text ``system`` message (persona/instructions layer)."""
        return cls(role="system", content=content)

    @classmethod
    def tool_call_result(cls, tool_call_result: ToolResult) -> Self:
        """Build the ``tool``-role result message for one executed tool call."""
        return cls(
            role="tool",
            content=tool_call_result.content,
            tool_calls=[tool_call_result.tool_call],
        )

    @classmethod
    def assistant(
        cls,
        content: str,
        thinking: str | None = None,
        tool_calls: list[ToolCall] | None = None,
    ) -> Self:
        """Build an ``assistant`` turn; either ``content`` or ``tool_calls`` may be empty."""
        return cls(
            role="assistant",
            content=content,
            thinking=thinking,
            tool_calls=tool_calls,
        )


class LLMClientProtocol(Protocol):
    """Structural interface for chat-completion clients (implemented by ``LLMClient``).

    Consumed by the agent loop and tool implementations so they never depend on
    a concrete provider client.
    """

    def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[BaseModel] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[BaseModel], None]:
        """Stream a completion as ``LLMEvent``s (deltas then one terminal event)."""
        ...

    def generate[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> Awaitable[LLMEvent[T]]:
        """Non-streaming convenience: await the terminal ``COMPLETE`` event.

        Raises on ``ERROR`` events or when no completion is produced.
        """
        ...
