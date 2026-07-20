import re
from typing import (
    Any,
    AsyncGenerator,
    Callable,
    Literal,
    NotRequired,
    Sequence,
    Type,
    TypedDict,
    TypeVar,
    Unpack,
)

from openai import APIConnectionError, APIError, AsyncOpenAI, RateLimitError
from openai.types.chat import (
    ChatCompletionChunk,
)
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from openai.types.shared_params import ResponseFormatJSONSchema
from openai.types.shared_params.response_format_json_schema import JSONSchema
from pydantic import BaseModel

from asterism.core import config
from asterism.core.utils.retries import retry_async_gen

from .helpers import format_messages_for_model
from .typedefs import (
    AvailableTools,
    LLMEvent,
    LLMEventType,
    Message,
    ToolCallDelta,
)


class ChatCompletionParams(TypedDict):
    reasoning_effort: NotRequired[Any]
    temperature: NotRequired[float]
    top_p: NotRequired[float]
    frequency_penalty: NotRequired[float]
    presence_penalty: NotRequired[float]
    seed: NotRequired[int]
    stop: NotRequired[str | Sequence[str]]
    extra_body: NotRequired[dict[str, Any]]
    tool_choice: NotRequired[Literal["required", "auto", "none"] | dict[str, Any]]
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
        self, available_tools: AvailableTools, response_model: Type[T] | None = None
    ):
        self.available_tools = available_tools
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
                        type=LLMEventType.THINKING_DELTA, content=self.full_thinking
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
                    LLMEvent(type=LLMEventType.TEXT_DELTA, content=self.full_content)
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
                    events.append(
                        LLMEvent(
                            type=LLMEventType.TOOL_CALL_START,
                            tool_call_delta=ToolCallDelta(**self.tool_calls_dict[idx]),
                        )
                    )

                if tc_chunk.function and tc_chunk.function.arguments:
                    self.tool_calls_dict[idx]["arguments"] += (
                        tc_chunk.function.arguments
                    )
                    events.append(
                        LLMEvent(
                            type=LLMEventType.TOOL_CALL_DELTA,
                            tool_call_delta=ToolCallDelta(**self.tool_calls_dict[idx]),
                        )
                    )

        return events

    def complete(self) -> list[LLMEvent]:
        events: list[LLMEvent] = []
        for tc_event in self.available_tools.prepare_tool_calls(
            self.tool_calls_dict.values()
        ):
            events.append(tc_event)

        parsed = None
        exception: Exception | None = None
        if self.full_content and self.response_model:
            try:
                content = re.sub(r"^(```[a-z]+\n|')", "", self.full_content.strip())
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
        messages: list[Message],
        available_tools: AvailableTools,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ):

        completion_args: dict[str, Any] = {
            "model": self.model_name,
            **kwargs,
        }

        if available_tools:
            completion_args["tools"] = [t.schema for _, t in available_tools.items()]

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
        messages: list[Message],
        tools: list[Callable[..., Any]] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[T], None]:

        if not messages:
            return

        available_tools = AvailableTools(tools or [])
        completion_args = self._prepare_completion_params(
            messages,
            available_tools,
            response_model,
            **kwargs,
        )

        @retry_async_gen(
            on_exceed_attempts=lambda e: self._error_to_event(e),
            no_retry=[APIError],
            max_retries=self.max_retries,
            delay_base=3,
        )
        async def async_chat_impl(
            **chat_args,
        ) -> AsyncGenerator[ChatCompletionChunk, None]:
            response = await self._client.chat.completions.create(
                stream=True, **chat_args, stream_options={"include_usage": True}
            )
            async for chunk in response:
                yield chunk

        processor = StreamingChunkProcessor(
            available_tools=available_tools,
            response_model=response_model,
        )

        async for chunk in async_chat_impl(**completion_args):
            for event in processor.process_chunk(chunk):
                yield event

        for event in processor.complete():
            yield event
