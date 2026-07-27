from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import (
    Any,
    AsyncGenerator,
    Literal,
    NotRequired,
    Sequence,
    Type,
    TypedDict,
    TypeVar,
    Unpack,
    cast,
)

from openai import (
    APIConnectionError,
    APIError,
    AsyncOpenAI,
    AsyncStream,
    RateLimitError,
)
from openai.types.chat import (
    ChatCompletionChunk,
)
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from openai.types.shared_params import ResponseFormatJSONSchema
from openai.types.shared_params.response_format_json_schema import JSONSchema
from pydantic import BaseModel

from asterism.core import config
from asterism.core.models import LLMMessage
from asterism.core.registries.tool import Function, ToolCall, tool_registry
from asterism.core.utils.retries import retry_async_gen

from .helpers import format_messages_for_model


class LLMEventType(StrEnum):
    TEXT_DELTA = "TEXT_DELTA"
    THINKING_DELTA = "THINKING_DELTA"
    THINKING_COMPLETE = "THINKING_COMPLETE"
    COMPLETE = "COMPLETE"
    ERROR = "ERROR"
    PARSE_ERROR = "PARSE_ERROR"


@dataclass
class LLMEvent[T_co: BaseModel]:
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
            "parsed": self.parsed.model_dump(mode="json")
            if self.parsed
            else None,
            "tool_calls": tool_calls if self.tool_calls else None,
        }


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
    max_completion_tokens: NotRequired[int]
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


T = TypeVar("T", bound=BaseModel)


class StreamingChunkProcessor:
    def __init__(
        self,
        response_model: Type[T] | None = None,
    ):
        self.response_model = response_model
        self.full_content = ""
        self.full_thinking = ""
        self.final_finish_reason = None
        self.token_usage: dict[str, int] | None = None
        self.tool_calls_dict: dict[int, dict[str, Any]] = {}
        self.mode: str = "EMPTY"

    def process_chunk(self, chunk: ChatCompletionChunk) -> list[LLMEvent]:
        events: list[LLMEvent] = []

        if chunk.usage:
            self.token_usage = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens,
            }
            return events

        for choice in chunk.choices:
            delta = choice.delta

            if choice.finish_reason is not None:
                self.final_finish_reason = choice.finish_reason

            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                self.mode = "thinking"
                self.full_thinking += reasoning
                events.append(
                    LLMEvent(
                        type=LLMEventType.THINKING_DELTA,
                        content=self.full_thinking,
                    )
                )
                continue

            if delta.content:
                if self.mode == "thinking" and self.full_thinking:
                    events.append(
                        LLMEvent(
                            type=LLMEventType.THINKING_COMPLETE,
                            content=self.full_thinking,
                        )
                    )
                self.mode = "content"
                self.full_content += delta.content
                events.append(
                    LLMEvent(
                        type=LLMEventType.TEXT_DELTA,
                        content=self.full_content,
                    )
                )
                continue

            if not delta.tool_calls:
                continue

            tc_chunk: ChoiceDeltaToolCall
            for tc_chunk in delta.tool_calls:
                idx = tc_chunk.index
                if idx not in self.tool_calls_dict and tc_chunk.id:
                    self.tool_calls_dict[idx] = {
                        "id": tc_chunk.id,
                        "name": "",
                        "arguments": "",
                    }
                if tc_chunk.function and tc_chunk.function.name:
                    self.tool_calls_dict[idx]["name"] = tc_chunk.function.name

                if tc_chunk.function and tc_chunk.function.arguments:
                    self.tool_calls_dict[idx]["arguments"] += (
                        tc_chunk.function.arguments
                    )

        return events

    def complete(self) -> list[LLMEvent]:
        events: list[LLMEvent] = []
        tool_calls: list[ToolCall] = [
            ToolCall(
                id=tc_dict["id"],
                function=Function(
                    name=tc_dict["name"], arguments=tc_dict["arguments"]
                ),
            )
            for tc_dict in self.tool_calls_dict.values()
        ]

        parsed = None
        exception: Exception | None = None
        if self.full_content and self.response_model:
            try:
                content = re.sub(
                    r"^(```[a-z]+\n|')", "", self.full_content.strip()
                )
                content = re.sub(r"(```|')$", "", content.strip()).strip()
                parsed = self.response_model.model_validate_json(content)
            except Exception as e:
                exception = e

        if exception:
            events.append(
                LLMEvent(
                    content=self.full_content,
                    exception=exception,
                    type=LLMEventType.PARSE_ERROR,
                )
            )

        events.append(
            LLMEvent(
                content=self.full_content,
                finish_reason=self.final_finish_reason,
                parsed=parsed,
                exception=exception,
                type=LLMEventType.COMPLETE,
                total_tokens=self.token_usage["completion_tokens"]
                if self.token_usage
                else None,
                tool_calls=tool_calls,
            )
        )

        return events


class LLMClient:
    def __init__(
        self,
        model_name: str,
        api_key: str,
        llm_host: str,
    ):
        self.max_retries: int = 3
        self.api_key: str = api_key
        self.base_url: str = llm_host
        self.model_name: str = model_name
        self._client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=120.0,
        )

    @staticmethod
    def _error_to_event(e: Exception) -> LLMEvent:
        text: str = str(e)
        if isinstance(e, APIError):
            text = "API Error: " + text
        elif isinstance(e, APIConnectionError):
            text = "API Connection Error: " + text
        elif isinstance(e, RateLimitError):
            text = "Rate Limit Error: " + text

        return LLMEvent(
            type=LLMEventType.ERROR,
            content=text,
            exception=e,
        )

    def _prepare_completion_params(
        self,
        messages: list[LLMMessage],
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ):

        completion_args: dict[str, Any] = {
            "model": self.model_name,
            "tools": tool_registry.schemas(),
            **kwargs,
        }

        if response_model and config.LLM_SUPPORTS_STRUCTURED_OUTPUT:

            def clean_schema(raw_schema: Any) -> Any:
                if isinstance(raw_schema, dict):
                    raw_schema.pop("title", None)
                    for key, value in list(raw_schema.items()):
                        if isinstance(value, (dict, list)):
                            clean_schema(value)
                elif isinstance(raw_schema, list):
                    for item in raw_schema:
                        clean_schema(item)
                return raw_schema

            sanitized_schema = clean_schema(response_model.model_json_schema())
            description = sanitized_schema.pop("description", "")
            completion_args["response_format"] = ResponseFormatJSONSchema(
                json_schema=JSONSchema(
                    name=response_model.__name__,
                    strict=True,
                    schema=sanitized_schema,
                    description=description,
                ),
                type="json_schema",
            )

        completion_args["messages"] = format_messages_for_model(messages)
        return completion_args

    async def chat(
        self,
        messages: list[LLMMessage],
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[T], None]:

        if not messages:
            return

        completion_args = self._prepare_completion_params(
            messages=messages,
            response_model=response_model,
            **kwargs,
        )

        @retry_async_gen(
            on_exceed_attempts=lambda e: self._error_to_event(e),
            no_retry=[APIError],
            max_retries=self.max_retries,
            delay_base=3,
        )
        async def async_chat_impl(
            **kwargs,
        ) -> AsyncGenerator[ChatCompletionChunk, None]:
            response = await self._client.chat.completions.create(  # type:ignore
                stream=True,
                stream_options={"include_usage": True},
                **kwargs,
            )
            async for chunk in cast(AsyncStream[ChatCompletionChunk], response):
                yield chunk

        processor = StreamingChunkProcessor(response_model=response_model)

        async for chunk in async_chat_impl(**completion_args):
            for event in processor.process_chunk(chunk):
                yield event

        for event in processor.complete():
            yield event
