import uuid

import httpx
import pytest
from asterism.domains.settings.discovery import (
    MAX_DISCOVERY_RESPONSE_BYTES,
    OpenAIProviderDiscovery,
    ProviderDiscoveryError,
    ProviderDiscoveryRequest,
    _extract_context_window,
    _extract_vision,
    _limit_response_size,
    merge_discovered_models,
)
from asterism.domains.settings.model_catalog import OPENAI_MODEL_CATALOG_VERSION
from asterism.domains.settings.provider_types import (
    OPENAI_BASE_URL,
    ModelCapabilitySource,
    ProviderType,
)
from asterism.domains.settings.schemas import Llm

API_KEY = "discovery-secret-canary"


def _request(
    *,
    provider_type=ProviderType.GENERIC_OPENAI,
    base_url="https://provider.example/v1",
    existing_models=None,
):
    return ProviderDiscoveryRequest(
        provider_type=provider_type,
        base_url=base_url,
        api_key=API_KEY,  # type: ignore
        provider_id=uuid.uuid4(),
        existing_models=existing_models or [],
    )


def _discovery(handler):
    return OpenAIProviderDiscovery(
        http_client_factory=lambda: httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            timeout=httpx.Timeout(1),
            follow_redirects=False,
            event_hooks={"response": [_limit_response_size]},
        )
    )


@pytest.mark.asyncio
async def test_openai_uses_canonical_origin_and_versioned_catalog():
    async def handler(request):
        assert str(request.url) == f"{OPENAI_BASE_URL}/models"
        assert request.headers["authorization"] == f"Bearer {API_KEY}"
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "gpt-4o-2024-11-20"},
                    {"id": "o3-mini"},
                    {"id": "future-x"},
                ]
            },
        )

    response = await _discovery(handler).discover(
        _request(
            provider_type=ProviderType.OPENAI,
            base_url="https://attacker.example/redirect",
        )
    )

    assert response.catalog_version == OPENAI_MODEL_CATALOG_VERSION
    assert response.models[0].context_window == 128_000
    assert response.models[0].supports_vision is True
    assert response.models[0].context_window_source == ModelCapabilitySource.CATALOG
    assert response.models[1].context_window == 200_000
    assert response.models[1].supports_vision is False
    assert response.models[1].vision_source == ModelCapabilitySource.CATALOG
    assert response.models[2].context_window is None
    assert response.models[2].supports_vision is None
    assert response.models[2].context_window_source == ModelCapabilitySource.UNKNOWN


@pytest.mark.parametrize(
    ("metadata", "context_window", "supports_vision"),
    [
        ({"context_window": 8192, "supports_vision": False}, 8192, False),
        (
            {"context_length": 16_384, "input_modalities": ["text", "image"]},
            16_384,
            True,
        ),
        (
            {"max_context_length": 32_768, "capabilities": {"vision": True}},
            32_768,
            True,
        ),
        (
            {
                "max_model_len": 4096,
                "architecture": {"input_modalities": ["images"]},
            },
            4096,
            True,
        ),
    ],
)
@pytest.mark.asyncio
async def test_generic_discovery_extracts_supported_metadata_shapes(metadata, context_window, supports_vision):
    async def handler(_request):
        return httpx.Response(200, json={"data": [{"id": "local", **metadata}]})

    response = await _discovery(handler).discover(_request())
    model = response.models[0]

    assert model.context_window == context_window
    assert model.supports_vision is supports_vision
    assert model.context_window_source == ModelCapabilitySource.PROVIDER
    assert model.vision_source == ModelCapabilitySource.PROVIDER


def test_extractors_leave_invalid_missing_and_conflicting_metadata_unknown():
    assert _extract_context_window({"context_window": 4096, "context_length": 8192}) == (None, True)
    assert _extract_context_window({"context_window": True, "context_length": -1}) == (
        None,
        False,
    )
    assert _extract_vision({"supports_vision": False, "input_modalities": ["text", "image"]}) == (None, True)
    assert _extract_vision({"input_modalities": ["text"]}) == (None, False)


@pytest.mark.asyncio
async def test_conflicting_generic_metadata_returns_warnings_and_unknown_values():
    async def handler(_request):
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "conflicted",
                        "context_window": 4096,
                        "max_model_len": 8192,
                        "supports_vision": False,
                        "capabilities": {"vision": True},
                    }
                ]
            },
        )

    response = await _discovery(handler).discover(_request())

    assert response.models[0].context_window is None
    assert response.models[0].supports_vision is None
    assert len(response.warnings) == 2
    assert all("conflicting" in warning for warning in response.warnings)


@pytest.mark.parametrize(
    ("response", "category"),
    [
        (httpx.Response(401), "authentication_failed"),
        (
            httpx.Response(
                302,
                headers={"location": "https://other.example/models"},
            ),
            "redirect_blocked",
        ),
        (httpx.Response(200, content=b"not-json"), "malformed_response"),
        (httpx.Response(200, json={"models": []}), "malformed_response"),
        (
            httpx.Response(200, content=b"x" * (MAX_DISCOVERY_RESPONSE_BYTES + 1)),
            "response_too_large",
        ),
    ],
)
@pytest.mark.asyncio
async def test_discovery_failures_are_actionable_and_redacted(
    response,
    category,
    caplog,
):
    async def handler(_request):
        return response

    with pytest.raises(ProviderDiscoveryError) as error:
        await _discovery(handler).discover(_request())

    assert error.value.category == category
    assert API_KEY not in str(error.value)
    assert API_KEY not in caplog.text
    assert any(getattr(record, "error_category", None) == category for record in caplog.records)


@pytest.mark.asyncio
async def test_connectivity_and_timeout_errors_are_categorized_without_secrets():
    for exception, category in [
        (httpx.ConnectError("failed with secret?"), "connectivity"),
        (httpx.ReadTimeout("timed out with secret?"), "timeout"),
    ]:

        async def handler(request, exception=exception):
            raise exception

        with pytest.raises(ProviderDiscoveryError) as error:
            await _discovery(handler).discover(_request())
        assert error.value.category == category
        assert API_KEY not in str(error.value)


def test_refresh_preserves_identity_active_state_manual_fields_and_draft():
    provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    draft_id = uuid.uuid4()
    existing = Llm(
        id=model_id,
        provider_id=provider_id,
        name="same-model",
        is_active=False,
        context_window=12_345,
        supports_vision=False,
        context_window_source=ModelCapabilitySource.MANUAL,
        vision_source=ModelCapabilitySource.MANUAL,
    )
    selected_draft = Llm(
        id=draft_id,
        provider_id=provider_id,
        name="temporarily-omitted",
        is_active=True,
    )
    discovered = Llm(
        id=uuid.uuid4(),
        provider_id=provider_id,
        name="same-model",
        is_active=True,
        context_window=128_000,
        supports_vision=True,
        context_window_source=ModelCapabilitySource.PROVIDER,
        vision_source=ModelCapabilitySource.PROVIDER,
    )

    merged = merge_discovered_models(
        [existing, selected_draft],
        [discovered],
        draft_model_id=draft_id,
    )

    assert merged[0].id == model_id
    assert merged[0].is_active is False
    assert merged[0].context_window == 12_345
    assert merged[0].supports_vision is False
    assert merged[0].context_window_source == ModelCapabilitySource.MANUAL
    assert merged[0].vision_source == ModelCapabilitySource.MANUAL
    assert merged[1] == selected_draft


def test_request_schema_marks_api_key_write_only_and_never_repr_leaks_secret():
    request = _request()
    properties = ProviderDiscoveryRequest.model_json_schema()["properties"]
    api_key_schema = properties["api_key"]

    assert api_key_schema["writeOnly"] is True
    assert API_KEY not in repr(request)
