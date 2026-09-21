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
    reasoning_effort: NotRequired[Any]
    temperature: NotRequired[float]
    top_p: NotRequired[float]
    frequency_penalty: NotRequired[float]
    presence_penalty: NotRequired[float]
    seed: NotRequired[int]
    stop: NotRequired[str | Sequence[str]]
    extra_body: NotRequired[dict[str, Any]]
    tool_choice: NotRequired[
        Literal["required", "auto", "none"] | dict[str, Any]
    ]
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


class DraftModel(BaseModel):
    repo_id: str
    filename: str


class LLMEventType(StrEnum):
    START = auto()
    COMPLETE = auto()
    TEXT_DELTA = auto()
    THINKING_DELTA = auto()
    ERROR = auto()


@dataclass(frozen=True)
class LLMEvent[T: BaseModel]:
    type: LLMEventType
    content: str = field(default="")
    thinking: str = field(default="")
    finish_reason: Optional[
        Literal[
            "stop", "length", "tool_calls", "content_filter", "function_call"
        ]
    ] = None
    exception: BaseException | None = field(default=None)
    input_tokens: int = field(default=0)
    output_tokens: int = field(default=0)
    total_tokens: int = field(default=0)
    generation_duration_ms: int = field(default=0)
    parsed: T | None = field(default=None)
    tool_calls: list["ToolCall"] | None = field(default=None)
    tool_result: "ToolResult | None" = field(default=None)

    def to_dict(self) -> dict[str, Any]:
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
            "parsed": self.parsed.model_dump(mode="json")
            if self.parsed
            else None,
            "tool_calls": tool_calls if self.tool_calls else None,
        }


class Function(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    function: Function
    type: Literal["function"] = "function"


@dataclass(frozen=True)
class ArgDesc:
    description: str


@dataclass
class ToolResult:
    content: str
    raw_result: Any
    is_empty: bool
    tool_call: ToolCall

    def to_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "raw_result": self.raw_result,
            "is_empty": self.is_empty,
            "tool_call": self.tool_call.model_dump(mode="json"),
        }


class TextContentPart(BaseModel):
    type: Literal["text"] = "text"
    text: str


class ImageUrlContent(BaseModel):
    url: str


class ImageUrlContentPart(BaseModel):
    type: Literal["image_url"] = "image_url"
    image_url: ImageUrlContent


ContentPart = Annotated[
    TextContentPart | ImageUrlContentPart,
    Field(discriminator="type"),
]


def text_content(message: "LLMMessage") -> str:
    """Return only textual content for non-multimodal consumers."""
    if isinstance(message.content, str):
        return message.content
    return "\n".join(part.text for part in message.content if isinstance(part, TextContentPart))


class LLMMessage(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
    )
    role: str
    content: str | list[ContentPart]
    thinking: str | None = Field(default=None)
    tool_calls: list[ToolCall] | None = Field(default=None)

    def to_api_message(self) -> dict[str, Any]:
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
                data["tool_calls"] = [
                    tc.model_dump(mode="json") for tc in self.tool_calls
                ]
            return data

        if not self.content:
            raise RuntimeError(f"Invalid message: {self}")

        return {"role": self.role, "content": self.content}

    @classmethod
    def user(cls, content: str) -> Self:
        return cls(role="user", content=content)

    @classmethod
    def system(cls, content: str) -> Self:
        return cls(role="system", content=content)

    @classmethod
    def tool_call_result(cls, tool_call_result: ToolResult):
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
        return cls(
            role="assistant",
            content=content,
            thinking=thinking,
            tool_calls=tool_calls,
        )


class LLMClientProtocol(Protocol):
    def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[BaseModel] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[BaseModel], None]: ...

    def generate[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> Awaitable[LLMEvent[T]]: ...
