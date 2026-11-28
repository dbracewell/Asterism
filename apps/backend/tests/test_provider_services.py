"""US-125.1 (ADR-0086): a service catalog, recorded on each OpenAI-compatible provider."""

import base64
import json
import os
import sqlite3
import uuid

import pytest
from asterism.db.migrate import script_directory
from asterism.domains.settings.models import ProviderModel
from asterism.domains.settings.provider_services import CATALOG, ProviderService
from asterism.domains.settings.provider_types import ProviderType
from asterism.domains.settings_transfer import documents
from migration_harness import upgrade_to
from sqlalchemy import select
from test_migrations import migration_db as _migration_db
from test_projects_api import auth
from test_settings_export import PASSPHRASE
from test_settings_export import api as _api
from test_settings_export import project_api as _project_api
from test_settings_import import IMPORT, bundle, fast_scrypt, post, provider, request

pytestmark = pytest.mark.asyncio
project_api, api, migration_db, fast_scrypt = _project_api, _api, _migration_db, fast_scrypt
REVISION = "9be2d4a01c7f"
SERVICES = "/settings/app/providers/services"
PROVIDERS = "/settings/app/providers"


def test_the_catalog_covers_every_service_once_with_https_for_hosted():
    assert [entry.service for entry in CATALOG] == list(ProviderService)
    for entry in CATALOG:
        assert entry.key_required == (entry.group != "local"), entry.service
        local = entry.base_url.startswith(("http://localhost:", "http://127.0.0.1:"))
        assert local if entry.group == "local" else entry.base_url.startswith("https://"), entry.service
        assert not entry.base_url.endswith("/") and entry.docs_url.startswith("https://")
        assert len(entry.service.value) <= 32


async def test_the_catalog_endpoint_is_for_admins(api):
    client, _ = api
    assert (await client.get(SERVICES, headers=auth("b"))).status_code == 403
    response = await client.get(SERVICES, headers=auth("a"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert [entry["service"] for entry in body] == [entry.service.value for entry in CATALOG]
    ollama = next(entry for entry in body if entry["service"] == "ollama")
    assert ollama == {
        "service": "ollama",
        "label": "Ollama",
        "group": "local",
        "base_url": ollama["base_url"],
        "key_required": False,
        "docs_url": ollama["docs_url"],
    }


async def test_a_provider_saves_and_reads_its_service(api):
    client, sessions = api
    current = (await client.get(PROVIDERS, headers=auth("a"))).json()
    assert {row["service"] for row in current["llm_providers"]} == {None}, "existing providers read as Custom"
    routed = {
        "id": str(uuid.uuid4()),
        "name": "OpenRouter",
        "provider_type": "generic_openai",
        "service": "openrouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": "sk-or",
    }
    body = {**current, "llm_providers": [*current["llm_providers"], routed]}
    saved = await client.put(PROVIDERS, headers=auth("a"), json=body)
    assert saved.status_code == 200, saved.text
    assert {row["name"]: row["service"] for row in saved.json()["llm_providers"]}["OpenRouter"] == "openrouter"
    async with sessions() as session:
        stored = await session.scalar(select(ProviderModel).where(ProviderModel.name == "OpenRouter"))
    assert stored is not None and stored.service == "openrouter"


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"provider_type": "openai", "base_url": "https://api.openai.com/v1"}, "Only an OpenAI-compatible provider"),
        ({"service": "not-a-service"}, "Input should be"),
    ],
)
async def test_a_service_on_the_wrong_provider_or_an_unknown_one_is_refused(api, changes, message):
    client, _ = api
    current = (await client.get(PROVIDERS, headers=auth("a"))).json()
    wrong = {
        "id": str(uuid.uuid4()),
        "name": "Wrong",
        "provider_type": "generic_openai",
        "service": "groq",
        "base_url": "https://api.groq.com/openai/v1",
        "api_key": "k",
        **changes,
    }
    response = await client.put(
        PROVIDERS, headers=auth("a"), json={**current, "llm_providers": [*current["llm_providers"], wrong]}
    )
    assert response.status_code == 422 and message in response.text


def version_2_file(item) -> dict:
    """A file as version 2 wrote it: providers have no ``service`` key."""
    payload = json.loads(item.model_dump_json())
    for row in payload["providers"]:
        del row["service"]
    salt = os.urandom(documents._SALT_BYTES)
    token = documents._fernet(PASSPHRASE, salt).encrypt(json.dumps(payload).encode())
    envelope = documents.SettingsEnvelope(
        format_version=2, salt=base64.b64encode(salt).decode(), ciphertext=token.decode()
    )
    return {"source": envelope.model_dump_json(), "passphrase": PASSPHRASE}


def test_settings_files_are_version_3_and_older_ones_still_open():
    assert documents.SETTINGS_FORMAT_VERSION == 3
    assert set(documents.SettingsEnvelope.model_fields["format_version"].annotation.__args__) == {1, 2, 3}


async def test_a_settings_file_carries_the_service_and_an_older_one_keeps_it(api):
    client, sessions = api
    named = bundle(providers=(provider(name="Local", service=ProviderService.OLLAMA),))
    imported = await post(client, IMPORT, request(named))
    assert imported.status_code == 200, imported.text

    async def service():
        async with sessions() as session:
            return await session.scalar(select(ProviderModel.service).where(ProviderModel.name == "Local"))

    assert await service() == "ollama"
    # A version 2 file has no service field: the provider keeps the one it has.
    older = await post(client, IMPORT, version_2_file(bundle(providers=(provider(name="Local"),))))
    assert older.status_code == 200, older.text
    assert await service() == "ollama"
    # A file that says Custom clears it.
    custom = bundle(providers=(provider(name="Local", service=None),))
    assert (await post(client, IMPORT, request(custom))).status_code == 200
    assert await service() is None

    wrong = bundle(
        providers=(
            provider(
                name="Wrong",
                provider_type=ProviderType.OPENAI,
                base_url="https://api.openai.com/v1",
                service=ProviderService.GROQ,
            ),
        )
    )
    refused = await post(client, IMPORT, request(wrong))
    assert refused.status_code == 400 and "can't have one" in refused.text


async def test_upgrade_adds_the_column_as_custom_and_keeps_providers_and_models(migration_db):
    previous = script_directory().get_revision(REVISION).down_revision
    await upgrade_to(migration_db, previous)
    generic, openai = uuid.uuid4().hex, uuid.uuid4().hex
    with sqlite3.connect(migration_db) as connection:
        connection.execute(
            "INSERT INTO providers (id, provider_type, name, base_url, api_key, created_at, updated_at) VALUES "
            "(?, 'generic_openai', 'Local', 'http://localhost:9000/v1', 'x', 0, 0), "
            "(?, 'openai', 'OpenAI', 'https://api.openai.com/v1', 'y', 0, 0)",
            (generic, openai),
        )
        connection.execute(
            "INSERT INTO models (id, provider_id, name, is_active) VALUES (?, ?, 'm1', 1)", (uuid.uuid4().hex, generic)
        )

    await upgrade_to(migration_db, REVISION)

    with sqlite3.connect(migration_db) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        rows = connection.execute("SELECT name, service FROM providers ORDER BY name").fetchall()
        assert rows == [("Local", None), ("OpenAI", None)]
        assert connection.execute("SELECT count(*) FROM models").fetchone() == (1,), "the rebuild keeps models"
        connection.execute("UPDATE providers SET service = 'ollama' WHERE id = ?", (generic,))
        with pytest.raises(sqlite3.IntegrityError, match="ck_providers_service_generic"):
            connection.execute("UPDATE providers SET service = 'groq' WHERE id = ?", (openai,))
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO providers (id, provider_type, name, base_url, api_key, created_at, updated_at) "
                "VALUES (?, 'generic_openai', 'Local', 'http://x/v1', 'z', 0, 0)",
                (uuid.uuid4().hex,),
            )
