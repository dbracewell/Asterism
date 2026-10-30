"""Responses API adapter against a local HTTP double behind the real OpenAI SDK."""

import json
import uuid
from typing import Any
from unittest.mock import patch

import asterism.domains.tools.builtin.date  # noqa: F401  (registers get_current_timestamp)
import httpx
import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEventType, AgentProfile
from asterism.domains.chat.schemas import Chat, ChatInfo
from asterism.domains.llm.capabilities import (
    CHAT_COMPLETIONS_CAPABILITIES,
    LLMApi,
    RequestCapabilities,
    ToolKind,
    request_capabilities,
)
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.errors import LLMProviderError
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.responses import ResponsesLLMClient, to_responses_input
from asterism.domains.llm.schemas import (
    Function,
    ImageUrlContent,
    ImageUrlContentPart,
    LLMEventType,
    LLMMessage,
    TextContentPart,
    ToolCall,
    ToolResult,
)
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import ProviderInfo
from openai import AsyncOpenAI
from tool_policy_doubles import isolated_tool_policy as _isolated_tool_policy

isolated_tool_policy = _isolated_tool_policy


def _sse(*events: dict[str, Any]) -> bytes:
    return b"".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n".encode() for event in events)


def _response(status: str, *, usage: dict[str, int] | None = None, **extra: Any) -> dict[str, Any]:
    return {
        "id": "resp_1",
        "object": "response",
        "created_at": 0,
        "model": "plan-model",
        "status": status,
        "output": [],
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
        "usage": usage,
        **extra,
    }


def _usage(input_tokens: int, output_tokens: int) -> dict[str, Any]:
    return {
        "input_tokens": input_tokens,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens": output_tokens,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": input_tokens + output_tokens,
    }


def _text(delta: str) -> dict[str, Any]:
    return {
        "type": "response.output_text.delta",
        "delta": delta,
        "item_id": "msg_1",
        "output_index": 0,
        "content_index": 0,
        "logprobs": [],
        "sequence_number": 1,
    }


def _completed(**usage: int) -> dict[str, Any]:
    return {
        "type": "response.completed",
        "response": _response("completed", usage=_usage(**usage)),
        "sequence_number": 9,
    }


def _function_call(item_id: str, call_id: str, name: str, arguments: str) -> list[dict[str, Any]]:
    item = {"type": "function_call", "id": item_id, "call_id": call_id, "name": name, "status": "in_progress"}
    return [
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {**item, "arguments": ""},
            "sequence_number": 2,
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": item_id,
            "output_index": 0,
            "delta": arguments[:3],
            "sequence_number": 3,
        },
        {
            "type": "response.function_call_arguments.delta",
            "item_id": item_id,
            "output_index": 0,
            "delta": arguments[3:],
            "sequence_number": 4,
        },
        {
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {**item, "arguments": arguments, "status": "completed"},
            "sequence_number": 5,
        },
    ]


class ResponsesDouble:
    """Scripted local ``POST /v1/responses`` endpoint that records request bodies."""

    def __init__(self, *replies: httpx.Response):
        self.replies = list(replies)
        self.requests: list[dict[str, Any]] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        assert request.headers["authorization"] == "Bearer plan-token"
        self.requests.append(json.loads(request.content))
        return self.replies.pop(0)

    def client(self, capabilities: RequestCapabilities | None = None) -> ResponsesLLMClient:
        sdk = AsyncOpenAI(
            api_key="plan-token",
            base_url="http://responses.test/v1",
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(self.handle)),
        )
        if capabilities is None:
            return ResponsesLLMClient(model_name="plan-model", api_key="plan-token", base_url="", client=sdk)
        return ResponsesLLMClient(
            model_name="plan-model", api_key="plan-token", base_url="", client=sdk, capabilities=capabilities
        )


def _stream(*events: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(*events))


@pytest.mark.asyncio
async def test_streams_text_and_reasoning_with_stateless_plan_request():
    double = ResponsesDouble(
        _stream(
            {
                "type": "response.reasoning_summary_text.delta",
                "delta": "Considering",
                "item_id": "rs_1",
                "output_index": 0,
                "summary_index": 0,
                "sequence_number": 0,
            },
            _text("Hello"),
            _text(" there"),
            _completed(input_tokens=12, output_tokens=4),
        ),
    )

    events = [
        event
        async for event in double.client().chat(
            messages=[LLMMessage.system("Be brief."), LLMMessage.user("Hi")],
            temperature=0.4,
            top_p=0.9,
            max_tokens=50,
            seed=7,
            reasoning_effort="low",
        )
    ]

    assert [event.type for event in events] == [
        LLMEventType.THINKING_DELTA,
        LLMEventType.TEXT_DELTA,
        LLMEventType.TEXT_DELTA,
        LLMEventType.COMPLETE,
    ]
    assert events[2].content == "Hello there"
    completed = events[-1]
    assert (completed.content, completed.thinking, completed.finish_reason) == ("Hello there", "Considering", "stop")
    assert (completed.input_tokens, completed.output_tokens, completed.total_tokens) == (12, 4, 16)
    assert completed.tool_calls == []

    body = double.requests[0]
    assert body == {
        "model": "plan-model",
        "instructions": "Be brief.",
        "input": [{"role": "user", "content": "Hi"}],
        "reasoning": {"effort": "low"},
        "stream": True,
        "store": False,
    }


@pytest.mark.asyncio
@pytest.mark.usefixtures("isolated_tool_policy")
async def test_tool_calls_run_through_the_agent_loop_with_stateless_history():
    double = ResponsesDouble(
        _stream(
            *_function_call("fc_1", "call_1", "get_current_timestamp", '{"x": 1}'),
            _completed(input_tokens=5, output_tokens=2),
        ),
        _stream(_text("It is noon."), _completed(input_tokens=9, output_tokens=3)),
    )
    profile = AgentProfile(
        name="Main",
        description="",
        sub_agent=False,
        model_id=None,
        system_prompt="",
        max_steps=3,
        tools=["get_current_timestamp"],
    )
    session = Chat(
        info=ChatInfo(id=uuid.uuid4(), user_id="user-a", created_at=0, updated_at=0, allowed_tools=[]),
        messages=[],
    )
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="user-a", email="a@test.local", name="A", role="user"),
        session=session,
        allowed_tools=["get_current_timestamp"],
    )
    agent._client = double.client()
    executed: list[ToolCall] = []

    async def get_client(self):
        return self._client

    async def system_prompt(self):
        await self.resolve_tools()
        return "Use tools."

    async def run_tools(self, user_message, auths, event_sink=None):
        for auth in auths:
            executed.append(auth.tool)
            yield ToolResult(content="12:00", raw_result="12:00", is_empty=False, tool_call=auth.tool)

    with (
        patch.object(Agent, "_get_client", get_client),
        patch.object(Agent, "_build_system_prompt", system_prompt),
        patch.object(Agent, "_run_tools", run_tools),
    ):
        events = [event async for event in agent.run([LLMMessage.user("What time is it?")])]

    assert [call.function.arguments for call in executed] == ['{"x": 1}']
    completes = [event for event in events if event.type == AgentEventType.COMPLETE]
    assert completes[-1].content == "It is noon."
    first, second = double.requests
    assert first["instructions"] == "Use tools."
    assert first["tools"] == [
        {
            "type": "function",
            "name": "get_current_timestamp",
            "parameters": first["tools"][0]["parameters"],
            "strict": True,
            "description": "Gets the current timestamp in UTC, ISO, and user-local time.",
        },
    ]
    assert second["input"] == [
        {"role": "user", "content": "What time is it?"},
        {"type": "function_call", "call_id": "call_1", "name": "get_current_timestamp", "arguments": '{"x": 1}'},
        {"type": "function_call_output", "call_id": "call_1", "output": "12:00"},
    ]


@pytest.mark.asyncio
async def test_stream_that_ends_without_a_terminal_event_is_an_error():
    double = ResponsesDouble(_stream(_text("partial")))

    events = [event async for event in double.client().chat(messages=[LLMMessage.user("Hi")])]

    assert [event.type for event in events] == [LLMEventType.TEXT_DELTA, LLMEventType.ERROR]
    assert isinstance(events[-1].exception, LLMProviderError)
    assert events[-1].exception.code == "stream_interrupted"


@pytest.mark.asyncio
async def test_dropped_connection_mid_stream_is_an_error_without_replay():
    class DroppingStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield _sse(_text("partial"))
            raise httpx.ReadError("connection reset")

    double = ResponsesDouble(
        httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=DroppingStream()),
    )

    events = [event async for event in double.client().chat(messages=[LLMMessage.user("Hi")])]

    assert [event.type for event in events] == [LLMEventType.TEXT_DELTA, LLMEventType.ERROR]
    assert len(double.requests) == 1


@pytest.mark.asyncio
async def test_failed_stream_keeps_the_provider_error_code():
    double = ResponsesDouble(
        _stream(
            _text("partial"),
            {
                "type": "response.failed",
                "response": _response(
                    "failed",
                    error={"code": "subscription_sharing_usage_limit_exceeded", "message": "Usage limit reached"},
                ),
                "sequence_number": 2,
            },
        ),
    )

    events = [event async for event in double.client().chat(messages=[LLMMessage.user("Hi")])]

    error = events[-1]
    assert error.type == LLMEventType.ERROR
    assert isinstance(error.exception, LLMProviderError)
    assert error.exception.code == "subscription_sharing_usage_limit_exceeded"
    assert error.content == "Usage limit reached"


@pytest.mark.asyncio
async def test_http_usage_limit_is_reported_once_and_not_retried():
    double = ResponsesDouble(
        httpx.Response(
            429,
            headers={"x-request-id": "req_123"},
            json={
                "error": {
                    "code": "subscription_sharing_usage_limit_exceeded",
                    "message": "Usage limit reached",
                    "param": None,
                    "type": "usage_limit",
                },
            },
        ),
    )

    events = [event async for event in double.client().chat(messages=[LLMMessage.user("Hi")])]

    assert [event.type for event in events] == [LLMEventType.ERROR]
    error = events[0].exception
    assert isinstance(error, LLMProviderError)
    assert (error.status, error.code, error.request_id) == (429, "subscription_sharing_usage_limit_exceeded", "req_123")
    assert len(double.requests) == 1


@pytest.mark.asyncio
async def test_incomplete_response_completes_with_length_and_drops_partial_calls():
    double = ResponsesDouble(
        _stream(
            *_function_call("fc_1", "call_1", "get_current_timestamp", '{"x": 1}'),
            {
                "type": "response.incomplete",
                "response": _response(
                    "incomplete",
                    usage=_usage(3, 1),
                    incomplete_details={"reason": "max_output_tokens"},
                ),
                "sequence_number": 6,
            },
        ),
    )

    events = [event async for event in double.client().chat(messages=[LLMMessage.user("Hi")])]

    completed = events[-1]
    assert completed.type == LLMEventType.COMPLETE
    assert completed.finish_reason == "length"
    assert completed.tool_calls == []


def test_history_maps_multimodal_input_assistant_turns_and_joined_instructions():
    call = ToolCall(id="call_1", function=Function(name="lookup", arguments="{}"))
    instructions, items = to_responses_input(
        [
            LLMMessage.system("Persona"),
            LLMMessage.system("Agent"),
            LLMMessage(
                role="user",
                content=[
                    TextContentPart(text="Describe"),
                    ImageUrlContentPart(image_url=ImageUrlContent(url="data:image/png;base64,AA==")),
                ],
            ),
            LLMMessage.assistant("Looking", tool_calls=[call]),
            LLMMessage.tool_call_result(ToolResult(content="found", raw_result=None, is_empty=False, tool_call=call)),
            LLMMessage.assistant("Done"),
        ],
    )

    assert instructions == "Persona\n\nAgent"
    assert items == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Describe"},
                {"type": "input_image", "image_url": "data:image/png;base64,AA=="},
            ],
        },
        {"role": "assistant", "content": "Looking"},
        {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
        {"type": "function_call_output", "call_id": "call_1", "output": "found"},
        {"role": "assistant", "content": "Done"},
    ]


def test_capabilities_decide_which_generation_parameters_are_sent():
    general = RequestCapabilities(
        api=LLMApi.RESPONSES,
        parameters=frozenset({"temperature", "max_tokens", "tool_choice"}),
        tool_kinds=frozenset({ToolKind.FUNCTION}),
    )
    request = (
        ResponsesDouble()
        .client(general)
        ._prepare_request(
            messages=[LLMMessage.user("Hi")],
            temperature=0.2,
            max_tokens=10,
            seed=3,
            tool_choice={"type": "function", "function": {"name": "lookup"}},
        )
    )

    assert request["temperature"] == 0.2
    assert request["max_output_tokens"] == 10
    assert request["tool_choice"] == {"type": "function", "name": "lookup"}
    assert "seed" not in request

    chat = LLMClient(model_name="model", api_key="key", base_url="http://example.test")._prepare_completion_params(
        messages=[LLMMessage.user("Hi")], temperature=0.2, max_tokens=10
    )
    assert (chat["temperature"], chat["max_tokens"]) == (0.2, 10)
    assert "seed" in chat


def test_tool_kinds_filter_unsupported_tool_schemas():
    schemas = [{"type": "function", "function": {"name": "a"}}, {"type": "image_generation"}]

    assert CHAT_COMPLETIONS_CAPABILITIES.supported_tools(schemas) == [schemas[0]]


@pytest.mark.parametrize("provider_type", list(ProviderType))
def test_existing_providers_keep_chat_completions(provider_type):
    provider = ProviderInfo(
        id=uuid.uuid4(),
        name="Provider",
        base_url="http://example.test/v1",
        api_key="key",  # type: ignore[arg-type]
        provider_type=provider_type,
    )

    assert request_capabilities(provider_type) is CHAT_COMPLETIONS_CAPABILITIES
    assert isinstance(create_llm_client("model", provider), LLMClient)
