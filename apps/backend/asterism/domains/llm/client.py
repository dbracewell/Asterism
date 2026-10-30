"""OpenAI-compatible chat-completion client and streaming event pipeline.

``LLMClient`` wraps the async OpenAI SDK against any OpenAI-compatible endpoint
(identified by ``base_url`` + API key). It streams chunks through
:class:`StreamHandler`, which accumulates text/thinking/tool-call deltas into
terminal :class:`~asterism.domains.llm.schemas.LLMEvent` events, with bounded
retries before the first chunk and a process-wide concurrency cap on provider
calls. A small pool of shared ``AsyncOpenAI`` HTTP clients (keyed by endpoint +
key) avoids re-creating connection pools per request; teardown happens in the
app lifespan via :func:`close_openai_clients`.
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import (
    Any,
    AsyncGenerator,
    Optional,
    Type,
    Unpack,
)

from openai import (
    APIError,
    AsyncOpenAI,
)
from openai.types import CompletionUsage
from openai.types.chat import (
    ChatCompletionChunk,
)
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from openai.types.shared_params import ResponseFormatJSONSchema
from openai.types.shared_params.response_format_json_schema import JSONSchema
from pydantic import BaseModel, SecretStr

from asterism.common.log import get_logger
from asterism.common.retries import retry_async_gen
from asterism.core.config import config
from asterism.domains.llm.typedefs import FinishReason
from asterism.domains.tools.registry import tool_registry

from .capabilities import CHAT_COMPLETIONS_CAPABILITIES, RequestCapabilities
from .schemas import (
    ChatCompletionParams,
    Function,
    LLMClientProtocol,
    LLMEvent,
    LLMEventType,
    LLMMessage,
    ToolCall,
)

logger = get_logger("LLM_CLIENT")


class LLMRequestLimiter:
    """Process-wide cap for provider calls, held for the full response stream.

    The slot is acquired before the HTTP request and released only after the
    stream is fully consumed (or closed), so the limit bounds concurrent
    *in-flight generations*, not just concurrent request starts.
    """

    def __init__(self, limit: int):
        self._semaphore = asyncio.Semaphore(limit)

    @asynccontextmanager
    async def acquire(self):
        """Hold one concurrency slot for the duration of the context."""
        await self._semaphore.acquire()
        try:
            yield
        finally:
            self._semaphore.release()


# Module-level singleton sized from config (validated 1..128 at startup).
llm_request_limiter = LLMRequestLimiter(config.max_concurrent_llm_requests)

# Some providers emit tool calls as literal text with spaces inside the angle
# brackets; the pattern matches exactly that shape (case-insensitive, any JSON
# payload between the tags).
_TEXT_TOOL_CALL_PATTERN = re.compile(
    r"<tool_call>\s*(\{.*?\})\s*</tool_call>",
    flags=re.DOTALL | re.IGNORECASE,
)


def extract_text_tool_calls(content: str) -> tuple[str, list[ToolCall]]:
    """Convert OpenAI-compatible providers' textual tool-call fallback.

    Some providers stream ``<tool_call>{...}</tool_call>`` in assistant text
    instead of populating ``delta.tool_calls``. Parsed calls still pass through
    the normal approval policy before execution.

    Args:
        content: Raw accumulated assistant text from a completed stream.

    Returns:
        ``(clean_content, calls)``. Every successfully parsed tag is removed
        from the text; malformed tags (bad JSON, missing/blank name, non-dict
        payload, or unparseable string arguments) are left in place and ignored.
        When nothing parses, returns the input unchanged with an empty list.
    """
    calls: list[ToolCall] = []
    parsed_spans: list[tuple[int, int]] = []

    for match in _TEXT_TOOL_CALL_PATTERN.finditer(content):
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue

        name = payload.get("tool_name", payload.get("name"))
        arguments = payload.get("arguments", {})
        if not isinstance(name, str) or not name.strip():
            continue
        if isinstance(arguments, str):
            try:
                json.loads(arguments)
            except json.JSONDecodeError:
                continue
            serialized_arguments = arguments
        elif isinstance(arguments, dict):
            serialized_arguments = json.dumps(arguments, separators=(",", ":"))
        else:
            continue

        calls.append(
            ToolCall(
                id=f"text_tool_{uuid.uuid4().hex}",
                function=Function(
                    name=name.strip(),
                    arguments=serialized_arguments,
                ),
            ),
        )
        parsed_spans.append(match.span())

    if not calls:
        return content, []

    clean_parts: list[str] = []
    cursor = 0
    for start, end in parsed_spans:
        clean_parts.append(content[cursor:start])
        cursor = end
    clean_parts.append(content[cursor:])
    clean_content = "".join(clean_parts).strip()
    return clean_content, calls


def structured_output_schema(response_model: Type[BaseModel]) -> tuple[str, dict[str, Any], str]:
    """Return ``(name, schema, description)`` for strict JSON-schema output.

    ``title`` keys are dropped recursively (strict JSON mode rejects them) and
    the top-level description is split out for the provider's format field.
    """

    def clean_schema(raw_schema: Any) -> Any:
        if isinstance(raw_schema, dict):
            raw_schema.pop("title", None)
            for value in list(raw_schema.values()):
                if isinstance(value, (dict, list)):
                    clean_schema(value)
        elif isinstance(raw_schema, list):
            for item in raw_schema:
                clean_schema(item)
        return raw_schema

    schema = clean_schema(response_model.model_json_schema())
    description = schema.pop("description", "")
    return response_model.__name__, schema, description


def parse_structured_output[T: BaseModel](response_model: Type[T], content: str) -> T:
    """Validate model text into ``response_model``.

    Models often wrap JSON in markdown fences, so a single leading/trailing
    fence pair is stripped first. Raises on validation failure.
    """
    clean_content = re.sub(r"^```(?:json)?\n?", "", content, flags=re.IGNORECASE)
    clean_content = re.sub(r"\n?```$", "", clean_content).strip()
    return response_model.model_validate_json(clean_content)


@dataclass
class StreamHandler[T: BaseModel]:
    """Stateful reducer that turns raw provider chunks into ``LLMEvent`` streams.

    One handler instance serves exactly one completion. It accumulates text and
    thinking deltas, assembles multi-chunk tool calls by index, captures the
    final usage block, and emits delta events while streaming plus a single
    terminal event (``COMPLETE`` or ``ERROR``) at the end.

    Fields:
        thinking: Accumulated reasoning/thinking text from the stream.
        content: Accumulated assistant text.
        final_finish_reason: Last non-None finish reason seen on any choice.
        usage: Provider-reported token usage (from the final chunk when the
            provider includes it).
        started_at: Monotonic timestamp used to report generation duration.
        tool_calls_dict: Partial tool calls keyed by provider index; name and
            argument fragments are concatenated across chunks.
        response_model: When set, the final text is validated into this model
            (after stripping markdown fences) and attached as ``parsed``.
    """

    thinking: str = ""
    content: str = ""
    final_finish_reason: Optional[FinishReason] = None
    usage: CompletionUsage | None = None
    started_at: float = field(default_factory=time.monotonic)
    tool_calls_dict: dict[int, dict[str, Any]] = field(default_factory=dict)
    response_model: Type[T] | None = None

    async def process(
        self,
        stream: AsyncGenerator[ChatCompletionChunk | BaseException | None, None],
    ) -> AsyncGenerator[LLMEvent, None]:
        """Consume a chunk stream and yield ``LLMEvent``s.

        The input may yield an exception object (instead of raising) when the
        retry wrapper gives up mid-stream; that is surfaced as an ``ERROR``
        event. On any error path the terminal ``COMPLETE``/validation block is
        skipped, but the underlying stream is always closed.
        """
        try:
            async for chunk in stream:
                if not chunk:
                    yield LLMEvent(
                        type=LLMEventType.ERROR,
                        content="Received empty chunk from LLM stream.",
                        exception=ValueError("Empty chunk received."),
                    )
                    return
                if isinstance(chunk, BaseException):
                    yield LLMEvent(
                        type=LLMEventType.ERROR,
                        content=str(chunk),
                        exception=chunk,
                    )
                    return
                if hasattr(chunk, "usage") and chunk.usage is not None:
                    self.usage = chunk.usage

                async for event in self._handle_chunk(chunk):
                    yield event
        finally:
            await stream.aclose()

        parsed = None
        self.content = self.content.strip()
        self.thinking = self.thinking.strip()

        # A validation failure is terminal (ERROR event) — no retry here.
        if self.response_model:
            try:
                parsed = parse_structured_output(self.response_model, self.content)
            except Exception as e:
                exception = e
                yield LLMEvent(
                    thinking=self.thinking,
                    content=self.content,
                    exception=exception,
                    finish_reason=self.final_finish_reason,
                    input_tokens=self.usage.prompt_tokens if self.usage else 0,
                    output_tokens=self.usage.completion_tokens if self.usage else 0,
                    total_tokens=self.usage.total_tokens if self.usage else 0,
                    generation_duration_ms=int((time.monotonic() - self.started_at) * 1000),
                    type=LLMEventType.ERROR,
                )

        # Assemble provider-native tool calls from the per-index fragments. If
        # the model produced none, fall back to recovering calls that were
        # emitted as literal text (some local providers) and treat the turn as
        # a tool-call turn so the agent loop keeps going.
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
        if not tool_calls:
            self.content, tool_calls = extract_text_tool_calls(self.content)
            if tool_calls:
                self.final_finish_reason = "tool_calls"
                logger.info(
                    "converted textual tool calls count=%d tools=%s",
                    len(tool_calls),
                    [call.function.name for call in tool_calls],
                )

        yield LLMEvent(
            type=LLMEventType.COMPLETE,
            content=self.content,
            thinking=self.thinking,
            finish_reason=self.final_finish_reason,
            parsed=parsed,
            input_tokens=self.usage.prompt_tokens if self.usage else 0,
            output_tokens=self.usage.completion_tokens if self.usage else 0,
            total_tokens=self.usage.total_tokens if self.usage else 0,
            generation_duration_ms=int((time.monotonic() - self.started_at) * 1000),
            tool_calls=tool_calls,
        )

    async def _handle_chunk(self, chunk: ChatCompletionChunk) -> AsyncGenerator[LLMEvent, None]:
        """Fold one provider chunk into accumulated state, yielding delta events.

        Handles reasoning (``reasoning_content``), text, and tool-call deltas.
        Delta events carry the *accumulated* (stripped) content, not just the
        increment, so consumers can render absolute state. Tool-call fragments
        are merged into ``tool_calls_dict`` by provider index; chunks without
        choices (usage-only finals) are ignored here.
        """
        if not hasattr(chunk, "choices") or not chunk.choices:
            return

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
                entry = self.tool_calls_dict.setdefault(
                    idx,
                    {
                        "id": tc_chunk.id or f"call_{idx}",
                        "name": "",
                        "arguments": "",
                    },
                )
                if tc_chunk.id:
                    entry["id"] = tc_chunk.id
                if tc_chunk.function and tc_chunk.function.name:
                    entry["name"] = tc_chunk.function.name
                if tc_chunk.function and tc_chunk.function.arguments:
                    entry["arguments"] += tc_chunk.function.arguments


# Process-wide pool of AsyncOpenAI clients keyed by (base_url, api_key) so that
# repeated LLMClient construction for the same provider reuses one HTTP
# connection pool. Entries are only removed at shutdown; a rotated API key or
# deleted provider leaves its entry until then.
_shared_openai_clients: dict[tuple[str, str], AsyncOpenAI] = {}
_shared_openai_clients_lock = threading.Lock()


def get_shared_openai_client(base_url: str, api_key: str) -> AsyncOpenAI:
    """Return the shared ``AsyncOpenAI`` client for an endpoint + key pair.

    Args:
        base_url: Provider root URL (OpenAI-compatible API).
        api_key: Plain-text API key; also part of the cache key.

    Creates the client on first use with a fixed 120s request timeout.
    """
    key = (base_url, api_key)
    with _shared_openai_clients_lock:
        client = _shared_openai_clients.get(key)
        if client is None:
            client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url,
                timeout=120.0,
            )
            _shared_openai_clients[key] = client
        return client


async def close_openai_clients() -> None:
    """Close and clear every pooled provider client (app-shutdown hook)."""
    with _shared_openai_clients_lock:
        clients = list(_shared_openai_clients.values())
        _shared_openai_clients.clear()
    for client in clients:
        await client.close()


class LLMClient(LLMClientProtocol):
    """Chat-completion client bound to one model on one OpenAI-compatible endpoint.

    Thin wrapper over ``AsyncOpenAI`` that normalizes provider streams into
    ``LLMEvent``s, applies the process-wide concurrency cap, and retries the
    request (bounded, pre-first-chunk only) on transient failures.
    """

    def __init__(
        self,
        model_name: str,
        api_key: SecretStr | str,
        base_url: str,
        client: AsyncOpenAI | None = None,
        capabilities: RequestCapabilities = CHAT_COMPLETIONS_CAPABILITIES,
    ) -> None:
        """Bind a model to an endpoint.

        Args:
            model_name: Model identifier sent as the ``model`` request field.
            api_key: Provider API key (str or SecretStr; stored as SecretStr).
            base_url: OpenAI-compatible endpoint root.
            client: Optional pre-built ``AsyncOpenAI``; when omitted, a shared
                pooled client for (base_url, api_key) is used — note that
                :meth:`close` on such a client closes the *shared* pool entry.
            capabilities: Request parameters and tool kinds the provider
                accepts; unsupported ones are omitted from requests.
        """
        self.max_retries: int = 3
        self.capabilities = capabilities
        self.api_key = api_key if isinstance(api_key, SecretStr) else SecretStr(api_key)
        self.base_url: str = base_url
        self.model_name: str = model_name
        self._client = client or get_shared_openai_client(
            base_url=self.base_url,
            api_key=self.api_key.get_secret_value(),
        )

    async def close(self) -> None:
        """Close the underlying HTTP client.

        Warning: when this instance was built without an explicit ``client``,
        ``self._client`` is a *shared* pooled client, so this also closes the
        pool entry for every other LLMClient on the same endpoint + key.
        """
        await self._client.close()

    def _prepare_completion_params[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> dict[str, Any]:
        """Build the provider request payload for one completion.

        Args:
            messages: Normalized conversation to send (copied, not mutated).
            tools: Tool *names* to expose; resolved to JSON schemas via the
                tool registry (omitted when the list is empty/None).
            response_model: When set, enables strict ``json_schema`` response
                format derived from the model's Pydantic schema.
            **kwargs: Optional completion parameters (temperature, top_p, ...);
                only those the provider's request capabilities support are
                forwarded, and caller-provided values win over the defaults
                applied here.

        Returns:
            Keyword arguments for ``chat.completions.create`` (without the
            streaming flags, which are added by :meth:`chat`).
        """
        completion_args: dict[str, Any] = {
            "model": self.model_name,
            **self.capabilities.request_parameters(kwargs),
        }
        schemas = self.capabilities.supported_tools(tool_registry.schemas(tools))
        if schemas:
            completion_args["tools"] = schemas

        # Default seed to wall-clock seconds unless the caller pins one; keeps
        # a single request stable across retries while varying between requests.
        if "seed" in self.capabilities.parameters and "seed" not in completion_args:
            completion_args["seed"] = int(time.time())

        if response_model:
            name, schema, description = structured_output_schema(response_model)
            completion_args["response_format"] = ResponseFormatJSONSchema(
                json_schema=JSONSchema(
                    name=name,
                    strict=True,
                    schema=schema,
                    description=description,
                ),
                type="json_schema",
            )

        msg_copy = messages.copy()
        completion_args["messages"] = [msg.to_api_message() for msg in msg_copy]
        return completion_args

    async def generate[T: BaseModel](
        self,
        messages: list[LLMMessage],
        tools: list[str] | None = None,
        response_model: Type[T] | None = None,
        **kwargs: Unpack[ChatCompletionParams],
    ) -> LLMEvent[T]:
        """Non-streaming convenience around :meth:`chat`.

        Discards delta events and returns the terminal ``COMPLETE`` event.
        Raises a plain ``Exception`` on ``ERROR`` events or when the stream
        produces no completion at all (e.g. empty message list).
        """
        last_event: LLMEvent[T] | None = None

        async for event in self.chat(
            messages=messages,
            tools=tools,
            response_model=response_model,
            **kwargs,
        ):
            if event.type == LLMEventType.ERROR:
                raise Exception(f"[CHAT ERROR: {event.content}]")
            elif event.type == LLMEventType.COMPLETE:
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
        """Stream a chat completion as ``LLMEvent``s.

        Yields delta events while tokens arrive, then exactly one terminal
        event (``COMPLETE`` or ``ERROR``). With an empty ``messages`` list it
        yields nothing at all. The provider request is retried up to
        ``max_retries`` times with exponential backoff, but only while no chunk
        has been emitted yet; later failures surface as an ``ERROR`` event.
        """

        if len(messages) == 0:
            return

        completion_args = self._prepare_completion_params(
            messages=messages,
            response_model=response_model,
            tools=tools,
            **kwargs,
        )

        @retry_async_gen(
            on_exceed_attempts=lambda e: e,
            no_retry=(APIError,),
            max_retries=self.max_retries,
            delay_base=3,
        )
        async def async_chat_impl(**kwargs):
            """One provider attempt under the global concurrency cap.

            On exhausted/aborted retries this yields the exception object
            itself (rather than raising), which ``StreamHandler.process`` turns
            into an ``ERROR`` event.
            """
            async with llm_request_limiter.acquire():
                response = await self._client.chat.completions.create(
                    stream=True,
                    stream_options={"include_usage": True},
                    **kwargs,
                )
                async for chunk in response:
                    yield chunk

        handler = StreamHandler(response_model=response_model)
        async for event in handler.process(async_chat_impl(**completion_args)):
            yield event
