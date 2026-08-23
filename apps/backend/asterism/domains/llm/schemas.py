from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import (
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

    # Extra body args
    thinking_budget_tokens: NotRequired[int]


class DraftModel(BaseModel):
    repo_id: str
    filename: str


class LLMEventType(StrEnum):
    START = "START"
    COMPLETE = "COMPLETE"
    TEXT_DELTA = "TEXT_DELTA"
    THINKING_DELTA = "THINKING_DELTA"
    ERROR = "ERROR"


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
    total_tokens: int = field(default=0)
    parsed: BaseModel | None = field(default=None)
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
            "total_tokens": self.total_tokens,
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


class LLMMessage(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
    )
    role: str
    content: str
    token_count: int
    thinking: str | None = Field(default=None)
    tool_calls: list[ToolCall] | None = Field(default=None)

    def to_api_message(self) -> dict[str, Any]:
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
        return cls(role="user", content=content, token_count=0)

    @classmethod
    def system(cls, content: str) -> Self:
        return cls(role="system", content=content, token_count=0)

    @classmethod
    def tool_call_result(cls, tool_call_result: ToolResult):
        return cls(
            role="tool",
            content=tool_call_result.content,
            token_count=0,
            tool_calls=[tool_call_result.tool_call],
        )

    @classmethod
    def assistant(
        cls,
        content: str,
        token_count: int,
        thinking: str | None = None,
        tool_calls: list[ToolCall] | None = None,
    ) -> Self:
        return cls(
            role="assistant",
            content=content,
            thinking=thinking,
            tool_calls=tool_calls,
            token_count=token_count,
        )


class LLMClientProtocol(Protocol):
    def generate(
        self,
        prompt: str,
        response_model: Type[BaseModel] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> Awaitable[str | BaseModel | Exception | None]: ...

    def chat(
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[BaseModel] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[BaseModel], None]: ...

    def chat_to_completion[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> Awaitable[LLMEvent[T]]: ...
