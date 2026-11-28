"""US-125.3: local servers and Custom providers work without an API key; no Authorization header is sent."""

import uuid

import httpx2
import pytest
from asterism.domains.llm.client import (
    NO_KEY_PLACEHOLDER,
    drop_placeholder_auth,
    get_shared_openai_client,
    keyless_auth,
)
from asterism.domains.settings.discovery import OpenAIProviderDiscovery, ProviderDiscoveryRequest
from asterism.domains.settings.models import ProviderModel
from asterism.domains.settings.provider_services import ProviderService
from asterism.domains.settings.provider_types import ProviderType
from openai import AsyncOpenAI
from sqlalchemy import select
from test_projects_api import auth
from test_settings_export import api as _api
from test_settings_export import project_api as _project_api
from test_settings_import import IMPORT, bundle, fast_scrypt, post, provider, request

pytestmark = pytest.mark.asyncio
project_api, api, fast_scrypt = _project_api, _api, fast_scrypt
PROVIDERS = "/settings/app/providers"


def recorder():
    seen: list[httpx2.Request] = []

    def handler(outgoing: httpx2.Request) -> httpx2.Response:
        seen.append(outgoing)
        if outgoing.url.path.endswith("/models"):
            return httpx2.Response(200, json={"object": "list", "data": [{"id": "llama3", "object": "model"}]})
        return httpx2.Response(
            200,
            json={
                "id": "c",
                "object": "chat.completion",
                "created": 0,
                "model": "llama3",
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "hi"}}],
            },
        )

    return seen, httpx2.MockTransport(handler)


@pytest.mark.parametrize(("key", "header"), [("", None), ("sk-local", "Bearer sk-local")])
async def test_a_client_sends_the_key_only_when_there_is_one(key, header):
    seen, transport = recorder()
    http_client = httpx2.AsyncClient(transport=transport, event_hooks={"request": [drop_placeholder_auth]})
    client = AsyncOpenAI(**keyless_auth(key), base_url="http://localhost:11434/v1", http_client=http_client)
    await client.models.list()
    await client.chat.completions.create(model="llama3", messages=[{"role": "user", "content": "hi"}])
    assert [request.headers.get("authorization") for request in seen] == [header, header]
    assert all(NO_KEY_PLACEHOLDER not in str(request.headers) for request in seen)


def test_the_shared_client_drops_the_placeholder_before_sending():
    client = get_shared_openai_client("http://localhost:11434/v1", "")
    assert drop_placeholder_auth in client._client.event_hooks["request"]


async def test_discovery_without_a_key_sends_no_authorization():
    seen, transport = recorder()
    discovery = OpenAIProviderDiscovery(transport=transport)
    response = await discovery.discover(
        ProviderDiscoveryRequest(
            provider_type=ProviderType.GENERIC_OPENAI,
            base_url="http://localhost:11434/v1",
            provider_id=uuid.uuid4(),
        )
    )
    assert [model.name for model in response.models] == ["llama3"]
    assert [request.headers.get("authorization") for request in seen] == [None]


def entry(name, service, base_url, api_key, provider_type="generic_openai", provider_id=None):
    return {
        "id": provider_id or str(uuid.uuid4()),
        "name": name,
        "provider_type": provider_type,
        "service": service,
        "base_url": base_url,
        "api_key": api_key,
    }


async def put(client, *providers):
    current = (await client.get(PROVIDERS, headers=auth("a"))).json()
    return await client.put(
        PROVIDERS, headers=auth("a"), json={**current, "llm_providers": [*current["llm_providers"], *providers]}
    )


async def test_local_and_custom_providers_save_without_a_key_and_others_need_one(api):
    client, sessions = api
    saved = await put(
        client,
        entry("Ollama", "ollama", "http://localhost:11434/v1", ""),
        entry("Box", None, "http://gpu-box:8000/v1", ""),
    )
    assert saved.status_code == 200, saved.text
    keys = {row["name"]: row["api_key"] for row in saved.json()["llm_providers"]}
    assert keys["Ollama"] == "" and keys["Box"] == "", "an empty key reads as empty, not redacted"
    assert keys["Local"] == "**********", "a saved key stays redacted"

    for name, service, url, provider_type in (
        ("OpenRouter", "openrouter", "https://openrouter.ai/api/v1", "generic_openai"),
        ("OpenAI", None, "https://api.openai.com/v1", "openai"),
    ):
        refused = await put(client, entry(name, service, url, "", provider_type))
        assert refused.status_code == 400 and f"{name} needs an API key" in refused.text


async def test_clearing_a_key_is_distinct_from_keeping_it(api):
    client, sessions = api
    current = (await client.get(PROVIDERS, headers=auth("a"))).json()
    local = current["llm_providers"][0]
    assert local["api_key"] == "**********"

    async def stored():
        async with sessions() as session:
            return await session.scalar(select(ProviderModel.api_key).where(ProviderModel.id == uuid.UUID(local["id"])))

    before = await stored()
    kept = await client.put(PROVIDERS, headers=auth("a"), json=current)
    assert kept.status_code == 200 and await stored() == before
    others = current["llm_providers"][1:]
    cleared = await client.put(
        PROVIDERS, headers=auth("a"), json={**current, "llm_providers": [{**local, "api_key": ""}, *others]}
    )
    assert cleared.status_code == 200, cleared.text
    assert await stored() == ""
    assert cleared.json()["llm_providers"][0]["api_key"] == ""


async def test_a_settings_file_may_omit_a_local_key_but_not_a_needed_one(api):
    client, _ = api
    local = bundle(providers=(provider(name="Local", service=ProviderService.OLLAMA, api_key=""),))
    assert (await post(client, IMPORT, request(local))).status_code == 200
    needed = bundle(providers=(provider(name="Router", service=ProviderService.OPENROUTER, api_key=""),))
    refused = await post(client, IMPORT, request(needed))
    assert refused.status_code == 400 and "no key for a provider that needs one" in refused.text
