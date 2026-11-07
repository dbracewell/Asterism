"""US-63.2: previewing and merging an encrypted settings file."""

import json
import uuid

import pytest
from asterism.core.events import EventType, event_bus
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.knowledge.policy import load_processing_configuration
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, ProviderModel
from asterism.domains.settings.provider_types import ModelCapabilitySource, ProviderType
from asterism.domains.settings.secrets import decrypt_component_provider_dict
from asterism.domains.settings_transfer import documents, importer
from asterism.domains.settings_transfer.documents import (
    ExportedCaptioning,
    ExportedComponent,
    ExportedModel,
    ExportedProvider,
    ModelReference,
    SettingsBundle,
    seal,
)
from asterism.domains.settings_transfer.export import collect_settings
from sqlalchemy import delete, select
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_settings_export import API_KEY, PASSPHRASE, SEARCH_KEY
from test_settings_export import api as _api

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
PREVIEW = "/settings/app/transfer/preview"
IMPORT = "/settings/app/transfer/import"
NEW_KEY = "imported-key-789"
OPEN_FAILED = "Could not open this file"


@pytest.fixture(autouse=True)
def fast_scrypt(monkeypatch):
    monkeypatch.setattr(documents, "_SCRYPT_N", 2**4)


def model(name="m1", **values):
    return ExportedModel(**{"name": name, "is_active": True, **values})


def provider(name="Imported", **values):
    fields = {
        "name": name,
        "provider_type": ProviderType.GENERIC_OPENAI,
        "base_url": "http://localhost:7000/v1",
        "api_key": NEW_KEY,
        "models": (model(),),
    }
    return ExportedProvider(**{**fields, **values})


def bundle(**values):
    return SettingsBundle(**{"exported_at": 100, "providers": (provider(),), **values})


def file(item=None, passphrase=PASSPHRASE):
    return seal(item if item is not None else bundle(), passphrase).model_dump_json()


def request(item=None, passphrase=PASSPHRASE):
    return {"source": file(item), "passphrase": passphrase}


async def post(client, url, body, user="a"):
    return await client.post(url, headers=auth(user), json=body)


async def state(sessions):
    async with sessions() as session:
        snapshot = await collect_settings(session)
    return snapshot.model_copy(update={"exported_at": 0})


async def test_preview_describes_the_merge_and_writes_nothing(api):
    client, sessions = api
    before = await state(sessions)
    item = bundle(
        providers=(provider(), provider("Local", models=(model("draft"), model("extra")))),
        active_tools=("web_fetch",),
        skills_enabled=False,
    )
    response = await post(client, PREVIEW, request(item))
    assert response.status_code == 200, response.text
    summary = response.json()
    assert summary["providers"] == [
        {"name": "Imported", "action": "add", "models_added": 1, "models_updated": 0},
        {"name": "Local", "action": "update", "models_added": 1, "models_updated": 1},
    ]
    assert "Active tools" in summary["changed_settings"]
    assert "Skills policy" in summary["changed_settings"]
    assert await state(sessions) == before


async def test_preview_holds_no_secrets(api):
    client, _ = api
    item = bundle(web_search_provider=ExportedComponent(name="s", parameters={"api_key": "file-search-key"}))
    response = await post(client, PREVIEW, request(item))
    for value in (NEW_KEY, "file-search-key", API_KEY, SEARCH_KEY):
        assert value not in response.text


async def test_providers_are_added_and_others_kept(api):
    client, sessions = api
    response = await post(client, IMPORT, request())
    assert response.status_code == 200, response.text
    assert "Local" in response.json()["kept_providers"]
    async with sessions() as session:
        rows = {row.name: row for row in await session.scalars(select(ProviderModel))}
        assert rows["Imported"].api_key == NEW_KEY
        assert rows["Imported"].base_url == "http://localhost:7000/v1"
        assert rows["Local"].api_key == API_KEY


async def test_key_is_encrypted_at_rest_with_this_instance(api):
    client, sessions = api
    await post(client, IMPORT, request())
    async with sessions() as session:
        raw = await session.connection()
        stored = (await raw.exec_driver_sql("select api_key from providers where name = 'Imported'")).scalar_one()
    assert stored.startswith("enc:v1:") and NEW_KEY not in stored


async def test_matching_provider_is_updated_in_place_and_keeps_model_ids(api):
    client, sessions = api
    async with sessions() as session:
        before = await session.scalar(select(LLMModel).where(LLMModel.name == "draft"))
        kept = await session.scalar(select(LLMModel).where(LLMModel.name == "vision"))
    incoming = provider(
        "Local",
        base_url="http://localhost:9100/v1",
        models=(
            model(
                "draft",
                supports_tools=False,
                tools_source=ModelCapabilitySource.MANUAL,
                display_name="Friendly",
            ),
            model("brand-new"),
        ),
    )
    assert (await post(client, IMPORT, request(bundle(providers=(incoming,))))).status_code == 200
    async with sessions() as session:
        row = await session.scalar(select(ProviderModel).where(ProviderModel.name == "Local"))
        names = {item.name: item for item in row.models}
        assert row.api_key == NEW_KEY and row.base_url == "http://localhost:9100/v1"
        assert names["draft"].id == before.id
        assert names["draft"].supports_tools is False and names["draft"].display_name == "Friendly"
        assert names["vision"].id == kept.id, "models the file lacks stay"
        assert "brand-new" in names


async def test_sub_agents_keep_working_after_a_merge(api):
    client, sessions = api
    async with sessions() as session:
        bound = await session.scalar(select(LLMModel).where(LLMModel.name == "draft"))
        session.add(
            AgentProfileModel(
                id=uuid.uuid4(),
                user_id="a",
                sub_agent=True,
                model_id=bound.id,
                name="Bound",
                description="",
                system_prompt="",
                max_steps=5,
                chat_parameters={},
                tools=[],
            )
        )
        await session.commit()
    assert (await post(client, IMPORT, request())).status_code == 200
    async with sessions() as session:
        agent = await session.scalar(select(AgentProfileModel).where(AgentProfileModel.name == "Bound"))
        assert agent.model_id == bound.id


async def test_settings_overwrite_and_keys_are_reencrypted(api):
    client, sessions = api
    item = bundle(
        draft_model=ModelReference(provider="Imported", model="m1"),
        active_tools=("web_fetch",),
        skills_enabled=False,
        chatgpt_plan_enabled=False,
        image_search_provider=ExportedComponent(name="img", parameters={"api_key": "img-key", "region": "eu"}),
    )
    assert (await post(client, IMPORT, request(item))).status_code == 200
    async with sessions() as session:
        settings = {row.key: row.value for row in await session.scalars(select(ApplicationSettingsModel))}
        imported = await session.scalar(select(LLMModel).where(LLMModel.name == "m1"))
    assert settings["active_tools"] == ["web_fetch"]
    assert settings["skills_enabled"] is False and settings["chatgpt_plan_enabled"] is False
    assert settings["draft_model_id"] == str(imported.id)
    assert "img-key" not in json.dumps(settings["image_search_provider"])
    assert decrypt_component_provider_dict(settings["image_search_provider"])["parameters"]["api_key"] == "img-key"


async def test_values_the_file_lacks_are_left_alone(api):
    client, sessions = api
    before = await state(sessions)
    item = before.model_copy(update={"draft_model": None, "web_search_provider": None})
    assert (await post(client, IMPORT, request(item))).status_code == 200
    after = await state(sessions)
    assert after.draft_model == before.draft_model
    assert after.web_search_provider == before.web_search_provider


async def test_draft_is_cleared_when_the_merge_deactivates_it(api):
    client, sessions = api
    incoming = provider("Local", models=(model("draft", is_active=False),))
    assert (await post(client, IMPORT, request(bundle(providers=(incoming,))))).status_code == 200
    async with sessions() as session:
        assert await session.get(ApplicationSettingsModel, "draft_model_id") is None


async def test_captioning_is_applied_by_name_through_the_policy_path(api):
    client, sessions = api
    vision = model(
        "see",
        supports_vision=True,
        vision_source=ModelCapabilitySource.MANUAL,
    )
    item = bundle(
        providers=(provider(models=(vision,)),),
        captioning=ExportedCaptioning(mode="provider", model=ModelReference(provider="Imported", model="see")),
    )
    response = await post(client, IMPORT, request(item))
    assert response.status_code == 200, response.text
    async with sessions() as session:
        _, processing = await load_processing_configuration(session=session)
        imported = await session.scalar(select(LLMModel).where(LLMModel.name == "see"))
    assert processing.captioning.provider_model_id == imported.id
    assert processing.generation == 2


async def test_failed_captioning_rolls_everything_back(api):
    client, sessions = api
    before = await state(sessions)
    item = bundle(
        active_tools=("changed",),
        captioning=ExportedCaptioning(mode="provider", model=ModelReference(provider="Imported", model="m1")),
    )
    response = await post(client, IMPORT, request(item))
    assert response.status_code == 400
    assert await state(sessions) == before


@pytest.mark.parametrize("failing", ["_apply_draft", "_put_component"])
async def test_late_failure_rolls_everything_back(api, monkeypatch, failing):
    client, sessions = api
    before = await state(sessions)

    async def explode(*_args, **_kwargs):
        raise RuntimeError("late failure")

    monkeypatch.setattr(importer, failing, explode)
    with pytest.raises(RuntimeError):
        await post(client, IMPORT, request(bundle(active_tools=("changed",))))
    assert await state(sessions) == before


@pytest.mark.parametrize("url", [PREVIEW, IMPORT])
async def test_wrong_passphrase_and_damage_change_nothing(api, url):
    client, sessions = api
    before = await state(sessions)
    good = json.loads(file())
    damaged = {**good, "ciphertext": good["ciphertext"][:-4] + "AAAA"}
    wrong = await post(client, url, {"source": json.dumps(good), "passphrase": "not the passphrase"})
    broken = await post(client, url, {"source": json.dumps(damaged), "passphrase": PASSPHRASE})
    assert wrong.status_code == broken.status_code == 400
    assert OPEN_FAILED in wrong.json()["detail"]
    assert wrong.json() == broken.json()
    assert await state(sessions) == before


@pytest.mark.parametrize(
    "source",
    ["not json", "{}", '{"format": "asterism.team-pack"}', json.dumps({"format": "asterism.settings-export"})],
)
async def test_other_files_are_refused(api, source):
    client, _ = api
    response = await post(client, PREVIEW, {"source": source, "passphrase": PASSPHRASE})
    assert response.status_code == 400
    assert "not an Asterism settings file" in response.json()["detail"]


async def test_newer_format_is_refused(api):
    client, _ = api
    source = json.dumps({**json.loads(file()), "format_version": 2})
    assert (await post(client, PREVIEW, {"source": source, "passphrase": PASSPHRASE})).status_code == 400


@pytest.mark.parametrize(
    ("item", "message"),
    [
        (lambda: bundle(providers=(provider(), provider())), "duplicate provider"),
        (lambda: bundle(providers=(provider(models=(model(), model())),)), "duplicate model"),
        (lambda: bundle(providers=(provider(api_key="**********"),)), "redacted"),
        (lambda: bundle(providers=(provider(base_url="ftp://host"),)), "invalid provider URL"),
        (lambda: bundle(providers=(provider(provider_type=ProviderType.CHATGPT),)), "cannot be imported"),
        (lambda: bundle(draft_model=ModelReference(provider="Imported", model="missing")), "does not contain"),
    ],
)
@pytest.mark.parametrize("url", [PREVIEW, IMPORT])
async def test_unsound_contents_are_refused(api, item, message, url):
    client, sessions = api
    before = await state(sessions)
    response = await post(client, url, request(item()))
    assert response.status_code == 400
    assert message in response.json()["detail"]
    assert await state(sessions) == before


async def test_only_admins_may_preview_or_import(api):
    client, sessions = api
    before = await state(sessions)
    for url in (PREVIEW, IMPORT):
        assert (await client.post(url, json=request())).status_code == 401
        assert (await post(client, url, request(), user="b")).status_code == 401
    assert await state(sessions) == before


async def test_import_never_logs_secrets(api, caplog):
    client, _ = api
    with caplog.at_level("DEBUG"):
        await post(client, IMPORT, request())
    for value in (NEW_KEY, PASSPHRASE):
        assert value not in caplog.text


async def test_import_tells_the_app_the_draft_may_have_changed(api, monkeypatch):
    client, _ = api
    events = []
    monkeypatch.setattr(event_bus, "emit", events.append)
    await post(client, IMPORT, request())
    assert [event.type for event in events] == [EventType.DRAFT_MODEL_UPDATED]


async def test_export_then_import_restores_a_wiped_instance(api, monkeypatch):
    client, sessions = api
    original = await state(sessions)
    exported = await client.post("/settings/app/transfer/export", headers=auth(), json={"passphrase": PASSPHRASE})
    assert exported.status_code == 200, exported.text
    async with sessions() as session:
        await session.execute(delete(ApplicationSettingsModel))
        await session.execute(delete(LLMModel))
        await session.execute(delete(ProviderModel))
        await session.commit()
    response = await post(client, IMPORT, {"source": exported.text, "passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    assert await state(sessions) == original
