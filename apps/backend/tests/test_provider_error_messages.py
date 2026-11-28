"""A provider's refusal reaches the person whatever shape its error body has (Gemini sends a list)."""

import logging

import httpx2
import pytest
from asterism.domains.llm.capabilities import CHAT_COMPLETIONS_CAPABILITIES
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.errors import LLMProviderError
from asterism.domains.llm.schemas import LLMEventType, LLMMessage
from openai import AsyncOpenAI

pytestmark = pytest.mark.asyncio
REASON = 'Invalid JSON payload received. Unknown name "foo": Cannot find field.'


async def failure(status: int, body) -> object:
    def handler(request):
        return httpx2.Response(status, json=body)

    sdk = AsyncOpenAI(
        api_key="k",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )
    client = LLMClient(
        model_name="gemini-2.5-flash",
        api_key="k",
        base_url="https://example.test/v1",
        capabilities=CHAT_COMPLETIONS_CAPABILITIES,
        client=sdk,
    )
    events = [event async for event in client.chat(messages=[LLMMessage.user("hi")])]
    [error] = [event for event in events if event.type == LLMEventType.ERROR]
    return error


@pytest.mark.parametrize(
    "body",
    [
        # Gemini's OpenAI compatibility layer: a list of error objects.
        [{"error": {"code": 400, "message": REASON, "status": "INVALID_ARGUMENT"}}],
        # OpenAI's own shape.
        {"error": {"code": "invalid_request_error", "message": REASON, "param": "foo"}},
    ],
)
async def test_the_provider_message_reaches_the_error_event(body, caplog):
    with caplog.at_level(logging.WARNING):
        error = await failure(400, body)
    assert isinstance(error.exception, LLMProviderError)
    assert error.exception.status == 400
    assert error.content.startswith("Error code: 400") and REASON in error.content
    assert error.exception.code in ("INVALID_ARGUMENT", "invalid_request_error")
    assert any("chat completion failed status=400" in record.getMessage() for record in caplog.records)
    assert all(REASON not in record.getMessage() for record in caplog.records), "the log names codes, not text"


async def test_a_body_without_a_message_keeps_the_status():
    error = await failure(400, {"unexpected": True})
    assert error.content.startswith("Error code: 400")
