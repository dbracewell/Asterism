from __future__ import annotations

import re
import time
from typing import (
    Any,
    AsyncGenerator,
    Literal,
    Optional,
    Type,
    Unpack,
    cast,
)

from openai import (
    APIConnectionError,
    APIError,
    AsyncOpenAI,
    RateLimitError,
)
from openai.types.chat import (
    ChatCompletionChunk,
)
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from openai.types.shared_params import ResponseFormatJSONSchema
from openai.types.shared_params.response_format_json_schema import JSONSchema
from pydantic import BaseModel

from asterism import config
from asterism.common import (
    ChatCompletionParams,
    Function,
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)
from asterism.utils.retries import retry_async_gen

from .helpers import format_messages_for_model


class StreamingChunkProcessor[T: BaseModel]:
    def __init__(
        self,
        response_model: Type[T] | None = None,
    ) -> None:
        self.response_model = response_model
        self.full_content: str = ""
        self.full_thinking: str = ""
        self.final_finish_reason: Optional[
            Literal["stop", "length", "tool_calls", "content_filter", "function_call"]
        ] = None
        self.token_usage: dict[str, int] | None = None
        self.tool_calls_dict: dict[int, dict[str, Any]] = {}
        self.is_thinking: bool = False

    def process_chunk(self, chunk: ChatCompletionChunk) -> list[LLMEvent]:
        events: list[LLMEvent] = []

        if chunk.usage:
            self.token_usage = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens,
            }

        for choice in chunk.choices:
            delta = choice.delta

            if choice.finish_reason is not None:
                self.final_finish_reason = choice.finish_reason

            reasoning: str | None = getattr(delta, "reasoning_content", None)
            if reasoning is not None:
                self.is_thinking = True
                self.full_thinking += reasoning
                events.append(
                    LLMEvent(
                        type=LLMEventType.THINKING_DELTA,
                        content=self.full_content.strip(),
                        thinking=self.full_thinking.strip(),
                    )
                )

            if delta.content is not None and delta.content != "":
                self.is_thinking = False
                self.full_content += delta.content
                events.append(
                    LLMEvent(
                        type=LLMEventType.TEXT_DELTA,
                        content=self.full_content.strip(),
                        thinking=self.full_thinking.strip(),
                    )
                )

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

        parsed = None
        if self.response_model:
            try:
                clean_content = re.sub(
                    r"^```(?:json)?\n?",
                    "",
                    self.full_content.strip(),
                    flags=re.IGNORECASE,
                )
                clean_content = re.sub(r"\n?```$", "", clean_content).strip()
                parsed = self.response_model.model_validate_json(clean_content)
            except Exception as e:
                exception = e
                events.append(
                    LLMEvent(
                        content=self.full_content.strip(),
                        exception=exception,
                        type=LLMEventType.ERROR,
                    )
                )
                return events

        tool_calls: list[ToolCall] = [
            ToolCall(
                id=tc_dict["id"],
                function=Function(
                    name=tc_dict["name"],
                    arguments=tc_dict["arguments"],
                ),
            )
            for tc_dict in self.tool_calls_dict.values()
        ]
        events.append(
            LLMEvent(
                type=LLMEventType.COMPLETE,
                content=self.full_content.strip(),
                thinking=self.full_thinking.strip(),
                finish_reason=self.final_finish_reason,
                parsed=parsed,
                total_tokens=self.token_usage["completion_tokens"]
                if self.token_usage
                else 0,
                tool_calls=tool_calls,
            )
        )

        return events


class LLMClient(LLMClientProtocol):
    def __init__(
        self,
        model_name: str,
        api_key: str,
        base_url: str,
    ) -> None:
        self.max_retries: int = 3
        self.api_key: str = api_key
        self.base_url: str = base_url
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

    def _prepare_completion_params[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        from asterism.registries.tool import tool_registry

        completion_args: dict[str, Any] = {
            "model": self.model_name,
            "tools": tool_registry.schemas(tools),
            **kwargs,
        }

        if "seed" not in completion_args:
            completion_args["seed"] = int(time.time())

        extrabody_args = {"top_k": 20, "min_p": 0.0}
        if "thinking_budget_tokens" in completion_args:
            extrabody_args["thinking_budget_tokens"] = completion_args.pop(
                "thinking_budget_tokens"
            )

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

        msg_copy = messages.copy()
        if msg_copy[0].role == "system":
            msg_copy[0].content = f"Time: {str(time.time())}\n{msg_copy[0].content}"
        else:
            msg_copy.insert(0, LLMMessage.system(f"Time: {str(time.time())}"))
        completion_args["messages"] = format_messages_for_model(msg_copy)
        return completion_args, extrabody_args

    async def generate[T: BaseModel](
        self,
        prompt: str,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> str | T | None:
        last_event: LLMEvent[T] = LLMEvent(type=LLMEventType.COMPLETE, content=prompt)

        async for event in self.chat(
            messages=[LLMMessage.user(prompt)],
            response_model=response_model,
            **kwargs,
        ):
            if event.type == LLMEventType.ERROR:
                raise Exception(f"[GENERATION ERROR: {event.content}]")
            last_event = event

        if last_event.parsed:
            return cast(T, last_event.parsed)

        return last_event.content

    async def chat_to_completion[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> LLMEvent[T]:
        last_event: LLMEvent[T] = LLMEvent(type=LLMEventType.COMPLETE)

        async for event in self.chat(
            messages=messages,
            tools=tools,
            response_model=response_model,
            **kwargs,
        ):
            if event.type == LLMEventType.ERROR:
                raise Exception(f"[CHAT ERROR: {event.content}]")
            last_event = event

        return last_event

    async def chat[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[T], None]:

        if not messages:
            return

        completion_args, extrabody_args = self._prepare_completion_params(
            messages=messages,
            response_model=response_model,
            tools=tools,
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
            response = await self._client.chat.completions.create(
                stream=True,
                stream_options={"include_usage": True},
                **kwargs,
                extra_body=extrabody_args,
            )
            async for chunk in response:
                yield chunk

        processor = StreamingChunkProcessor(response_model=response_model)

        yield LLMEvent(type=LLMEventType.START)
        async for chunk in async_chat_impl(**completion_args):
            if isinstance(chunk, LLMEvent):
                yield chunk
                if chunk.type == LLMEventType.ERROR:
                    return

            for event in processor.process_chunk(chunk):
                yield event

        for event in processor.complete():
            yield event
