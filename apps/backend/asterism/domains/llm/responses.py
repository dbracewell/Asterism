"""Responses API streaming client and event reducer.

``ResponsesLLMClient`` implements the same ``LLMClientProtocol`` as the Chat
Completions ``LLMClient`` for providers that only support ``POST /v1/responses``.
Requests are stateless (``store: false``, ``stream: true``): system messages
become ``instructions`` and the rest of the history is resent as ``input`` items
every call. :class:`ResponsesStreamHandler` folds the typed stream events into
the same ``LLMEvent`` stream the agent loop already consumes.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Type, Unpack

from openai import APIError, AsyncOpenAI
from openai.types.responses import Response, ResponseStreamEvent
from pydantic import BaseModel, SecretStr

from asterism.common.log import get_logger
from asterism.common.retries import retry_async_gen
from asterism.domains.llm.typedefs import FinishReason
from asterism.domains.tools.registry import tool_registry

from .capabilities import CHATGPT_PLAN_CAPABILITIES, RequestCapabilities
from .client import (
    get_shared_openai_client,
    llm_request_limiter,
    parse_structured_output,
    structured_output_schema,
)
from .errors import LLMProviderError
from .schemas import (
    ChatCompletionParams,
    Function,
    ImageUrlContentPart,
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)

logger = get_logger("LLM_RESPONSES")

# Asterism parameter name -> Responses request field. Parameters without a
# Responses equivalent (seed, stop, penalties, n, logprobs, ...) are never sent.
_PARAMETER_FIELDS = {
    "temperature": "temperature",
    "top_p": "top_p",
    "max_tokens": "max_output_tokens",
    "parallel_tool_calls": "parallel_tool_calls",
    "extra_headers": "extra_headers",
    "extra_query": "extra_query",
    "extra_body": "extra_body",
    "timeout": "timeout",
}

_INCOMPLETE_FINISH_REASONS: dict[str, FinishReason] = {
    "max_output_tokens": "length",
    "content_filter": "content_filter",
}


def to_responses_input(messages: list[LLMMessage]) -> tuple[str, list[dict[str, Any]]]:
    """Split normalized history into ``(instructions, input items)``.

    System messages are joined into ``instructions`` because explicit system
    input items are rejected by some Responses providers. Assistant tool calls
    become ``function_call`` items and tool results ``function_call_output``
    items, linked by call ID.
    """
    instructions: list[str] = []
    items: list[dict[str, Any]] = []
    for message in messages:
        if message.role == "system":
            if isinstance(message.content, str) and message.content:
                instructions.append(message.content)
            continue

        if message.role == "tool":
            if not message.tool_calls:
                raise RuntimeError("Tool result message has no originating tool call")
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": message.tool_calls[0].id,
                    "output": message.content,
                },
            )
            continue

        if isinstance(message.content, list):
            if message.role != "user":
                raise RuntimeError("Only user messages may use structured content")
            items.append(
                {
                    "role": "user",
                    "content": [
                        (
                            {"type": "input_image", "image_url": part.image_url.url}
                            if isinstance(part, ImageUrlContentPart)
                            else {"type": "input_text", "text": part.text}
                        )
                        for part in message.content
                    ],
                },
            )
            continue

        if message.role == "assistant":
            if message.content:
                items.append({"role": "assistant", "content": message.content})
            for tool_call in message.tool_calls or []:
                items.append(
                    {
                        "type": "function_call",
                        "call_id": tool_call.id,
                        "name": tool_call.function.name,
                        "arguments": tool_call.function.arguments,
                    },
                )
            continue

        if not message.content:
            raise RuntimeError(f"Invalid message: {message}")
        items.append({"role": message.role, "content": message.content})

    return "\n\n".join(instructions), items


def to_responses_tool(schema: dict[str, Any]) -> dict[str, Any]:
    """Flatten a Chat Completions function tool into the Responses shape."""
    function = schema["function"]
    tool: dict[str, Any] = {
        "type": "function",
        "name": function["name"],
        "parameters": function.get("parameters"),
        "strict": function.get("strict", False),
    }
    if function.get("description"):
        tool["description"] = function["description"]
    return tool


def _to_responses_tool_choice(tool_choice: Any) -> Any:
    if isinstance(tool_choice, dict) and isinstance(tool_choice.get("function"), dict):
        return {"type": "function", "name": tool_choice["function"]["name"]}
    return tool_choice


@dataclass
class ResponsesStreamHandler[T: BaseModel]:
    """Stateful reducer from Responses stream events to ``LLMEvent``s.

    One handler serves exactly one response. Text and reasoning deltas are
    accumulated and re-emitted as running totals; function calls are assembled
    per output item. The stream must end with ``response.completed`` or
    ``response.incomplete`` to produce ``COMPLETE``; ``response.failed``, an
    ``error`` event, an exception, or a stream that ends early produce one
    ``ERROR`` event carrying an :class:`LLMProviderError`.
    """

    thinking: str = ""
    content: str = ""
    started_at: float = field(default_factory=time.monotonic)
    tool_calls_by_item: dict[str, dict[str, str]] = field(default_factory=dict)
    response_model: Type[T] | None = None

    async def process(
        self,
        stream: AsyncGenerator[ResponseStreamEvent | BaseException, None],
    ) -> AsyncGenerator[LLMEvent, None]:
        """Consume an event stream and yield ``LLMEvent``s; always closes it."""
        try:
            async for event in stream:
                if isinstance(event, BaseException):
                    yield self._error(event)
                    return
                match event.type:
                    case "response.output_text.delta":
                        self.content += event.delta
                        yield self._delta(LLMEventType.TEXT_DELTA)
                    case "response.reasoning_summary_text.delta" | "response.reasoning_text.delta":
                        self.thinking += event.delta
                        yield self._delta(LLMEventType.THINKING_DELTA)
                    case "response.output_item.added" | "response.output_item.done":
                        if event.item.type == "function_call" and event.item.id:
                            self.tool_calls_by_item[event.item.id] = {
                                "id": event.item.call_id,
                                "name": event.item.name,
                                "arguments": event.item.arguments,
                            }
                    case "response.function_call_arguments.delta":
                        entry = self.tool_calls_by_item.get(event.item_id)
                        if entry is not None:
                            entry["arguments"] += event.delta
                    case "response.function_call_arguments.done":
                        entry = self.tool_calls_by_item.get(event.item_id)
                        if entry is not None:
                            entry["arguments"] = event.arguments
                    case "response.completed":
                        yield self._complete(event.response, incomplete_reason=None)
                        return
                    case "response.incomplete":
                        details = event.response.incomplete_details
                        yield self._complete(
                            event.response,
                            incomplete_reason=details.reason if details else None,
                        )
                        return
                    case "response.failed":
                        error = event.response.error
                        yield self._error(
                            LLMProviderError(
                                error.message if error else "Response failed",
                                code=error.code if error else None,
                            ),
                        )
                        return
                    case "error":
                        yield self._error(LLMProviderError(event.message, code=event.code, param=event.param))
                        return
        finally:
            await stream.aclose()

        yield self._error(LLMProviderError("Response stream ended before completion", code="stream_interrupted"))

    def _delta(self, event_type: LLMEventType) -> LLMEvent:
        return LLMEvent(type=event_type, content=self.content.strip(), thinking=self.thinking.strip())

    def _duration_ms(self) -> int:
        return int((time.monotonic() - self.started_at) * 1000)

    def _error(self, error: BaseException) -> LLMEvent:
        if isinstance(error, APIError):
            error = LLMProviderError.from_api_error(error)
        logger.warning(
            "responses stream failed code=%s status=%s",
            getattr(error, "code", None),
            getattr(error, "status", None),
        )
        return LLMEvent(
            type=LLMEventType.ERROR,
            content=str(error),
            thinking=self.thinking.strip(),
            exception=error,
            generation_duration_ms=self._duration_ms(),
        )

    def _complete(self, response: Response, *, incomplete_reason: str | None) -> LLMEvent:
        content = self.content.strip()
        usage = response.usage
        tokens = {
            "input_tokens": usage.input_tokens if usage else 0,
            "output_tokens": usage.output_tokens if usage else 0,
            "total_tokens": usage.total_tokens if usage else 0,
        }
        # Calls in an incomplete response may be truncated; never execute them.
        tool_calls = (
            [
                ToolCall(id=entry["id"], function=Function(name=entry["name"], arguments=entry["arguments"]))
                for entry in self.tool_calls_by_item.values()
            ]
            if incomplete_reason is None
            else []
        )
        finish_reason: FinishReason | None
        if incomplete_reason is not None:
            finish_reason = _INCOMPLETE_FINISH_REASONS.get(incomplete_reason, "length")
        else:
            finish_reason = "tool_calls" if tool_calls else "stop"

        parsed = None
        if self.response_model and not tool_calls:
            try:
                parsed = parse_structured_output(self.response_model, content)
            except Exception as error:
                return LLMEvent(
                    type=LLMEventType.ERROR,
                    content=content,
                    thinking=self.thinking.strip(),
                    exception=error,
                    finish_reason=finish_reason,
                    generation_duration_ms=self._duration_ms(),
                    **tokens,
                )

        return LLMEvent(
            type=LLMEventType.COMPLETE,
            content=content,
            thinking=self.thinking.strip(),
            finish_reason=finish_reason,
            parsed=parsed,
            tool_calls=tool_calls,
            generation_duration_ms=self._duration_ms(),
            **tokens,
        )


class ResponsesLLMClient(LLMClientProtocol):
    """Responses API client bound to one model on one endpoint.

    Mirrors ``LLMClient``: the process-wide concurrency cap is held for the full
    stream and the request is retried (bounded, before the first event only) on
    transient non-API failures. Provider API errors are never retried here.
    """

    def __init__(
        self,
        model_name: str,
        api_key: SecretStr | str,
        base_url: str,
        client: AsyncOpenAI | None = None,
        capabilities: RequestCapabilities = CHATGPT_PLAN_CAPABILITIES,
    ) -> None:
        self.max_retries: int = 3
        self.capabilities = capabilities
        self.api_key = api_key if isinstance(api_key, SecretStr) else SecretStr(api_key)
        self.base_url = base_url
        self.model_name = model_name
        # SDK retries are disabled: usage-limit (429) and other provider errors
        # must surface immediately instead of being retried behind the caller.
        self._client = (
            client
            or get_shared_openai_client(
                base_url=self.base_url,
                api_key=self.api_key.get_secret_value(),
            )
        ).with_options(max_retries=0)

    def _prepare_request[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> dict[str, Any]:
        """Build the ``responses.create`` arguments (without ``stream``/``store``).

        Only parameters allowed by the request capabilities are mapped to their
        Responses fields; everything else is omitted rather than sent.
        """
        params = self.capabilities.request_parameters(kwargs)
        instructions, input_items = to_responses_input(messages)
        request: dict[str, Any] = {"model": self.model_name, "input": input_items}
        if instructions:
            request["instructions"] = instructions

        for name, value in params.items():
            if name in _PARAMETER_FIELDS:
                request[_PARAMETER_FIELDS[name]] = value
        if params.get("reasoning_effort") is not None:
            request["reasoning"] = {"effort": params["reasoning_effort"]}
        if "tool_choice" in params:
            request["tool_choice"] = _to_responses_tool_choice(params["tool_choice"])

        schemas = self.capabilities.supported_tools(tool_registry.schemas(tools))
        if schemas:
            request["tools"] = [to_responses_tool(dict(schema)) for schema in schemas]

        if response_model:
            name, schema, description = structured_output_schema(response_model)
            request["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": name,
                    "schema": schema,
                    "description": description,
                    "strict": True,
                },
            }
        return request

    async def generate[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> LLMEvent[T]:
        """Await the terminal ``COMPLETE`` event; raises on ``ERROR``."""
        last_event: LLMEvent[T] | None = None
        async for event in self.chat(messages=messages, tools=tools, response_model=response_model, **kwargs):
            if event.type == LLMEventType.ERROR:
                raise Exception(f"[CHAT ERROR: {event.content}]")
            if event.type == LLMEventType.COMPLETE:
                last_event = event
        if not last_event:
            raise Exception("No completion event received from LLM.")
        return last_event

    async def chat[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> AsyncGenerator[LLMEvent[T], None]:
        """Stream one stateless response as ``LLMEvent``s.

        Yields deltas, then exactly one terminal ``COMPLETE`` or ``ERROR``. An
        empty ``messages`` list yields nothing.
        """
        if len(messages) == 0:
            return

        request = self._prepare_request(messages=messages, tools=tools, response_model=response_model, **kwargs)

        @retry_async_gen(
            on_exceed_attempts=lambda e: e,
            no_retry=(APIError,),
            max_retries=self.max_retries,
            delay_base=3,
        )
        async def async_responses_impl(**request):
            async with llm_request_limiter.acquire():
                stream = await self._client.responses.create(stream=True, store=False, **request)
                async for event in stream:
                    yield event

        handler = ResponsesStreamHandler(response_model=response_model)
        async for event in handler.process(async_responses_impl(**request)):
            yield event
