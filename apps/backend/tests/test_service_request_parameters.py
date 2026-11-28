"""Gemini's OpenAI compatibility refuses ``seed``, so its providers never send one (ADR-0086)."""

import json
import uuid

import httpx2
import pytest
from asterism.domains.llm.capabilities import request_capabilities
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.schemas import LLMMessage
from asterism.domains.settings.provider_services import ProviderService
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import RuntimeProviderInfo
from openai import AsyncOpenAI

pytestmark = pytest.mark.asyncio
COMPLETION = {
    "id": "c",
    "object": "chat.completion.chunk",
    "created": 0,
    "model": "m",
    "choices": [{"index": 0, "delta": {"content": "hi"}, "finish_reason": "stop"}],
}


async def sent_body(service: ProviderService | None, **params) -> dict:
    bodies: list[dict] = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx2.Response(
            200,
            text=f"data: {json.dumps(COMPLETION)}\n\ndata: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )

    sdk = AsyncOpenAI(
        api_key="k",
        base_url="https://example.test/v1",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)),
    )
    client = LLMClient(
        model_name="m",
        api_key="k",
        base_url="https://example.test/v1",
        capabilities=request_capabilities(ProviderType.GENERIC_OPENAI, service),
        client=sdk,
    )
    [event async for event in client.chat(messages=[LLMMessage.user("hi")], **params)]
    [body] = bodies
    return body


async def test_gemini_requests_carry_no_seed_and_others_still_do():
    assert "seed" not in await sent_body(ProviderService.GEMINI)
    assert "seed" not in await sent_body(ProviderService.GEMINI, seed=7), "a configured seed is dropped too"
    gemini = await sent_body(ProviderService.GEMINI, temperature=0.2)
    assert gemini["temperature"] == 0.2, "other parameters still go"
    for service in (ProviderService.OPENROUTER, ProviderService.OLLAMA, None):
        assert isinstance((await sent_body(service))["seed"], int), service


def test_the_factory_uses_the_providers_service():
    def provider(service):
        return RuntimeProviderInfo(
            id=uuid.uuid4(),
            name="P",
            base_url="https://generativelanguage.googleapis.com/v1beta/openai",
            api_key="k",  # type: ignore[arg-type]
            provider_type=ProviderType.GENERIC_OPENAI,
            service=service,
        )

    gemini = create_llm_client("gemini-2.5-flash", provider(ProviderService.GEMINI), usage=None)
    custom = create_llm_client("gemini-2.5-flash", provider(None), usage=None)
    assert "seed" not in gemini.capabilities.parameters
    assert "seed" in custom.capabilities.parameters
