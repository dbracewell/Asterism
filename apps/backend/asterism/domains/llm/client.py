from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncGenerator,
    Optional,
    Type,
    Unpack,
)

from openai import (
    APIConnectionError,
    APIError,
    AsyncOpenAI,
    RateLimitError,
)
from openai.types import CompletionUsage
from openai.types.chat import (
    ChatCompletionChunk,
)
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from openai.types.shared_params import ResponseFormatJSONSchema
from openai.types.shared_params.response_format_json_schema import JSONSchema
from pydantic import BaseModel

from asterism.common.retries import retry_async_gen
from asterism.domains.llm.typedefs import FinishReason
from asterism.domains.tools.registry import tool_registry

from .helpers import format_messages_for_model
from .schemas import (
    ChatCompletionParams,
    Function,
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)


@dataclass
class StreamHandler[T: BaseModel]:
    thinking: str = ""
    content: str = ""
    final_finish_reason: Optional[FinishReason] = None
    usage: CompletionUsage | None = None
    tool_calls_dict: dict[int, dict[str, Any]] = field(default_factory=dict)
    response_model: Type[T] | None = None

    async def process(
        self, stream: AsyncGenerator[ChatCompletionChunk, None]
    ) -> AsyncGenerator[LLMEvent, None]:

        async for chunk in stream:
            if chunk.usage:
                self.usage = chunk.usage

            async for event in self._handle_chunk(chunk):
                yield event

        parsed = None
        self.content = self.content.strip()
        self.thinking = self.thinking.strip()

        if self.response_model:
            try:
                clean_content = re.sub(
                    r"^```(?:json)?\n?",
                    "",
                    self.content,
                    flags=re.IGNORECASE,
                )
                clean_content = re.sub(r"\n?```$", "", clean_content).strip()
                parsed = self.response_model.model_validate_json(clean_content)
            except Exception as e:
                exception = e
                yield LLMEvent(
                    thinking=self.thinking,
                    content=self.content,
                    exception=exception,
                    finish_reason=self.final_finish_reason,
                    total_tokens=self.usage.completion_tokens if self.usage else 0,
                    type=LLMEventType.ERROR,
                )

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
        yield LLMEvent(
            type=LLMEventType.COMPLETE,
            content=self.content,
            thinking=self.thinking,
            finish_reason=self.final_finish_reason,
            parsed=parsed,
            total_tokens=self.usage.completion_tokens if self.usage else 0,
            tool_calls=tool_calls,
        )

    async def _handle_chunk(
        self, chunk: ChatCompletionChunk
    ) -> AsyncGenerator[LLMEvent, None]:
        for choice in chunk.choices:
            if choice.finish_reason is not None:
                self.final_finish_reason = choice.finish_reason

            delta = choice.delta

            reasoning: str | None = getattr(delta, "reasoning_content", None)
            if reasoning is not None:
                self.thinking += reasoning
                yield LLMEvent(
                    type=LLMEventType.THINKING_DELTA,
                    content=self.content.strip(),
                    thinking=self.thinking.strip(),
                )

            if delta.content is not None and delta.content != "":
                self.content += delta.content
                yield LLMEvent(
                    type=LLMEventType.TEXT_DELTA,
                    content=self.content.strip(),
                    thinking=self.thinking.strip(),
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
    def _error_to_event(e: BaseException) -> LLMEvent:
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

        if response_model:

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

        if len(messages) == 0:
            return

        completion_args, extrabody_args = self._prepare_completion_params(
            messages=messages,
            response_model=response_model,
            tools=tools,
            **kwargs,
        )

        @retry_async_gen(
            on_exceed_attempts=lambda e: self._error_to_event(e),
            no_retry=(APIError,),
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

        handler = StreamHandler(response_model=response_model)
        async for event in handler.process(async_chat_impl(**completion_args)):
            yield event
