"""US-63.1: exporting application settings to a passphrase-encrypted file."""

import base64
import json
import uuid

import pytest
import pytest_asyncio
from asterism.core.exceptions import BadDataException, UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.domains.knowledge.policy import (
    KNOWLEDGE_PROCESSING_SETTING_KEY,
    default_processing_configuration,
)
from asterism.domains.knowledge.processing_schemas import KnowledgeProcessingCaptioningConfiguration
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, ProviderModel
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings.schemas import ApplicationSettings
from asterism.domains.settings.secrets import encrypt_component_provider_dict
from asterism.domains.settings_transfer.documents import SettingsBundle, SettingsEnvelope, seal, unseal
from sqlalchemy import func, select
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
PASSPHRASE = "correct horse battery"
URL = "/settings/app/transfer/export"
API_KEY = "provider-key-value-123"
SEARCH_KEY = "search-key-value-456"


@pytest_asyncio.fixture
async def api(project_api, monkeypatch):
    client, sessions, _ = project_api

    def verify_token(token):
        if token not in ("a", "b"):
            raise UnauthorizedException()
        role = "admin" if token == "a" else "user"
        return AuthedUser(id=token, email=f"{token}@example.test", name=token, role=role)

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", verify_token)
    async with sessions() as session:
        provider = ProviderModel(name="Local", base_url="http://localhost:9000/v1", api_key=API_KEY)
        session.add(provider)
        await session.flush()
        draft = LLMModel(
            provider_id=provider.id, name="draft", is_active=True, supports_tools=True, context_window=8000
        )
        vision = LLMModel(provider_id=provider.id, name="vision", is_active=False, supports_vision=True)
        session.add_all([draft, vision])
        await session.flush()
        processing = default_processing_configuration().model_copy(
            update={
                "captioning": KnowledgeProcessingCaptioningConfiguration(mode="provider", provider_model_id=vision.id)
            }
        )
        session.add_all(
            [
                ApplicationSettingsModel(key="draft_model_id", value=str(draft.id)),
                ApplicationSettingsModel(key="active_tools", value=["web_search"]),
                ApplicationSettingsModel(key="skills_enabled", value=True),
                ApplicationSettingsModel(key="chatgpt_plan_enabled", value=True),
                ApplicationSettingsModel(
                    key="web_search_provider",
                    value=encrypt_component_provider_dict(
                        {"name": "search", "parameters": {"api_key": SEARCH_KEY, "region": "uk"}}
                    ),
                ),
                ApplicationSettingsModel(
                    key=KNOWLEDGE_PROCESSING_SETTING_KEY, value=processing.model_dump(mode="json")
                ),
            ]
        )
        await session.commit()
    return client, sessions


async def exported(client) -> tuple[dict, SettingsBundle]:
    response = await client.post(URL, headers=auth(), json={"passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    data = response.json()
    return data, unseal(SettingsEnvelope.model_validate(data), PASSPHRASE)


async def test_file_holds_every_setting_with_keys_intact(api):
    client, _ = api
    _, bundle = await exported(client)
    provider = next(item for item in bundle.providers if item.name == "Local")
    assert provider.api_key == API_KEY
    assert provider.base_url == "http://localhost:9000/v1"
    assert [model.name for model in provider.models] == ["draft", "vision"]
    assert provider.models[0].supports_tools is True and provider.models[0].context_window == 8000
    assert bundle.draft_model.model_dump() == {"provider": "Local", "model": "draft"}
    assert bundle.active_tools == ("web_search",)
    assert bundle.skills_enabled is True and bundle.chatgpt_plan_enabled is True
    assert bundle.web_search_provider.parameters == {"api_key": SEARCH_KEY, "region": "uk"}
    assert bundle.image_search_provider is None
    assert bundle.captioning.mode == "provider"
    assert bundle.captioning.model.model_dump() == {"provider": "Local", "model": "vision"}


async def test_nothing_is_readable_without_the_passphrase(api):
    client, _ = api
    data, _ = await exported(client)
    assert set(data) == {"format", "format_version", "salt", "ciphertext"}
    text = json.dumps(data)
    for value in (API_KEY, SEARCH_KEY, "Local", "localhost", "draft"):
        assert value not in text
    decoded = base64.urlsafe_b64decode(data["ciphertext"])
    assert API_KEY.encode() not in decoded


async def test_file_carries_no_record_ids(api):
    client, sessions = api
    _, bundle = await exported(client)
    async with sessions() as session:
        ids = [str(item) for item in await session.scalars(select(LLMModel.id))]
    text = bundle.model_dump_json()
    assert not any(item in text for item in ids)


async def test_user_owned_chatgpt_providers_stay_out(api):
    client, sessions = api
    async with sessions() as session:
        session.add(
            ProviderModel(
                name="Plan",
                provider_type=ProviderType.CHATGPT,
                owner_user_id="b",
                base_url="https://chatgpt.com/backend-api",
                api_key="plan-secret",
            )
        )
        await session.commit()
    _, bundle = await exported(client)
    assert "Plan" not in [item.name for item in bundle.providers]
    assert "plan-secret" not in bundle.model_dump_json()


async def test_references_to_a_missing_model_are_dropped(api):
    client, sessions = api
    async with sessions() as session:
        row = await session.get(ApplicationSettingsModel, "draft_model_id")
        row.value = str(uuid.uuid4())
        await session.commit()
    _, bundle = await exported(client)
    assert bundle.draft_model is None


async def test_export_changes_nothing(api):
    client, sessions = api

    async def snapshot():
        async with sessions() as session:
            rows = await session.scalars(select(ApplicationSettingsModel).order_by(ApplicationSettingsModel.key))
            count = await session.scalar(select(func.count()).select_from(ProviderModel))
            return [(row.key, row.value) for row in rows], count

    before = await snapshot()
    await exported(client)
    assert await snapshot() == before


async def test_only_admins_may_export(api):
    client, _ = api
    assert (await client.post(URL, json={"passphrase": PASSPHRASE})).status_code == 401
    refused = await client.post(URL, headers=auth("b"), json={"passphrase": PASSPHRASE})
    assert refused.status_code == 401
    assert "ciphertext" not in refused.text


@pytest.mark.parametrize("passphrase", ["short", "x" * 1025])
async def test_passphrase_length_is_bounded(api, passphrase):
    client, _ = api
    response = await client.post(URL, headers=auth(), json={"passphrase": passphrase})
    assert response.status_code == 422
    assert passphrase not in response.text


async def test_export_never_logs_secrets(api, caplog):
    client, _ = api
    with caplog.at_level("DEBUG"):
        await exported(client)
    for value in (API_KEY, SEARCH_KEY, PASSPHRASE):
        assert value not in caplog.text


async def test_each_export_is_salted():
    bundle = SettingsBundle(exported_at=1)
    first, second = seal(bundle, PASSPHRASE), seal(bundle, PASSPHRASE)
    assert first.salt != second.salt and first.ciphertext != second.ciphertext


async def test_passphrase_is_compared_after_unicode_normalization():
    envelope = seal(SettingsBundle(exported_at=1), "café passphrase")
    assert unseal(envelope, "café passphrase").exported_at == 1


async def test_wrong_passphrase_and_tampering_fail_alike():
    envelope = seal(SettingsBundle(exported_at=1), PASSPHRASE)
    flipped = envelope.ciphertext[:-3] + ("A" if envelope.ciphertext[-3] != "A" else "B") + envelope.ciphertext[-2:]
    attempts = [
        (envelope, "another passphrase"),
        (envelope.model_copy(update={"ciphertext": flipped}), PASSPHRASE),
        (envelope.model_copy(update={"salt": base64.b64encode(b"0" * 16).decode()}), PASSPHRASE),
        (envelope.model_copy(update={"salt": "not base64!"}), PASSPHRASE),
        (envelope.model_copy(update={"salt": base64.b64encode(b"0" * 4).decode()}), PASSPHRASE),
    ]
    messages = set()
    for item, passphrase in attempts:
        with pytest.raises(BadDataException) as error:
            unseal(item, passphrase)
        messages.add(str(error.value))
    assert len(messages) == 1


async def test_bundle_covers_every_application_setting():
    """Fails when a new admin setting has not been added to the file."""
    mapped = {"llm_providers": "providers", "draft_model_id": "draft_model"}
    for field in ApplicationSettings.model_fields:
        assert mapped.get(field, field) in SettingsBundle.model_fields
    assert "captioning" in SettingsBundle.model_fields
