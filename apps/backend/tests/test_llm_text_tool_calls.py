import asyncio
import json
from types import SimpleNamespace

import pytest
from asterism.domains.llm.client import (
    LLMClient,
    LLMRequestLimiter,
    StreamHandler,
    extract_text_tool_calls,
)
from asterism.domains.llm.schemas import LLMEventType, LLMMessage


@pytest.mark.asyncio
async def test_stream_usage_keeps_input_output_and_total_separate():
    async def stream():
        yield SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=120, completion_tokens=30, total_tokens=150),
            choices=[],
        )

    events = [event async for event in StreamHandler().process(stream())]
    completed = events[-1]

    assert completed.input_tokens == 120
    assert completed.output_tokens == 30
    assert completed.total_tokens == 150
    assert completed.generation_duration_ms >= 0


@pytest.mark.asyncio
async def test_llm_request_limiter_caps_concurrent_provider_streams():
    limiter = LLMRequestLimiter(2)
    active = 0
    peak = 0
    release = asyncio.Event()
    started = asyncio.Event()

    async def request():
        nonlocal active, peak
        async with limiter.acquire():
            active += 1
            peak = max(peak, active)
            if active == 2:
                started.set()
            await release.wait()
            active -= 1

    tasks = [asyncio.create_task(request()) for _ in range(3)]
    await started.wait()
    await asyncio.sleep(0)
    assert peak == 2

    release.set()
    await asyncio.gather(*tasks)
    assert peak == 2


def test_legacy_thinking_budget_is_not_sent_to_the_provider():
    client = LLMClient(model_name="model", api_key="key", base_url="http://example.test")

    completion_args = client._prepare_completion_params(
        messages=[LLMMessage.user("Hello")],
        thinking_budget_tokens=10,  # type: ignore[call-arg]
    )

    assert "thinking_budget_tokens" not in completion_args


def test_extracts_multiple_textual_tool_calls_from_provider_output():
    content = (
        '<tool_call> {"tool_name":"weather","arguments":'
        '{"location":"Dallas, Texas"}} </tool_call>\n'
        '<tool_call> {"tool_name":"web_search","arguments":'
        '{"query":"current Dallas weather"}} </tool_call>'
    )

    clean_content, calls = extract_text_tool_calls(content)

    assert clean_content == ""
    assert [call.function.name for call in calls] == ["weather", "web_search"]
    assert json.loads(calls[0].function.arguments) == {
        "location": "Dallas, Texas",
    }
    assert json.loads(calls[1].function.arguments) == {
        "query": "current Dallas weather",
    }
    assert calls[0].id != calls[1].id


def test_preserves_surrounding_text_and_string_arguments():
    content = (
        "I will check.\n"
        '<tool_call>{"name":"web_search","arguments":'
        '"{\\"query\\":\\"Dallas weather\\"}"}</tool_call>\n'
        "Please wait."
    )

    clean_content, calls = extract_text_tool_calls(content)

    assert clean_content == "I will check.\n\nPlease wait."
    assert len(calls) == 1
    assert calls[0].function.name == "web_search"
    assert json.loads(calls[0].function.arguments) == {
        "query": "Dallas weather",
    }


@pytest.mark.asyncio
async def test_stream_handler_converts_text_calls_and_continues_agent_loop():
    handler = StreamHandler()
    handler.content = '<tool_call>{"tool_name":"web_search","arguments":{"query":"Dallas weather"}}</tool_call>'

    async def empty_stream():
        if False:
            yield None

    events = [event async for event in handler.process(empty_stream())]

    assert len(events) == 1
    assert events[0].type == LLMEventType.COMPLETE
    assert events[0].content == ""
    assert events[0].finish_reason == "tool_calls"
    assert events[0].tool_calls is not None
    assert events[0].tool_calls[0].function.name == "web_search"


def test_leaves_malformed_or_unsupported_textual_calls_as_content():
    malformed = '<tool_call>{"tool_name":"web_search",oops}</tool_call>'
    unsupported = '<tool_call>{"tool_name":"web_search","arguments":[]}</tool_call>'

    assert extract_text_tool_calls(malformed) == (malformed, [])
    assert extract_text_tool_calls(unsupported) == (unsupported, [])


def test_provider_payload_omits_tools_without_an_explicit_effective_set():
    client = LLMClient(model_name="model", api_key="key", base_url="http://example.test")
    for tools in (None, []):
        assert "tools" not in client._prepare_completion_params(messages=[LLMMessage.user("Hello")], tools=tools)


@pytest.mark.asyncio
async def test_shared_openai_clients_reuse_and_shutdown():
    from asterism.domains.llm.client import (
        close_openai_clients,
        get_shared_openai_client,
    )

    client1 = get_shared_openai_client("http://example.test", "key1")
    client2 = get_shared_openai_client("http://example.test", "key1")
    client3 = get_shared_openai_client("http://other.test", "key1")

    assert client1 is client2
    assert client1 is not client3

    await close_openai_clients()

    # After close, dict is cleared, new request creates a fresh client
    client4 = get_shared_openai_client("http://example.test", "key1")
    assert client4 is not client1
    await close_openai_clients()


@pytest.mark.asyncio
async def test_llm_client_chat_acquires_request_limiter(monkeypatch):
    from asterism.domains.llm.client import llm_request_limiter

    acquired = False

    orig_acquire = llm_request_limiter.acquire

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def track_acquire():
        nonlocal acquired
        acquired = True
        async with orig_acquire():
            yield

    monkeypatch.setattr(llm_request_limiter, "acquire", track_acquire)

    client = LLMClient(model_name="model", api_key="key", base_url="http://example.test")

    async def fake_chunks():
        yield SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="hi", tool_calls=None), finish_reason="stop")],
            usage=None,
        )

    class FakeCompletions:
        async def create(self, **kwargs):
            return fake_chunks()

    class FakeChat:
        completions = FakeCompletions()

    monkeypatch.setattr(client._client, "chat", FakeChat())

    events = [event async for event in client.chat(messages=[LLMMessage.user("hi")])]
    assert acquired is True
    assert any(e.type == LLMEventType.COMPLETE for e in events)
