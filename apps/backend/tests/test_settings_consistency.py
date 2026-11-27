"""US-117.1: settings and admin consistency."""

import pytest
from asterism.domains.settings import settings_router
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, ProviderModel
from sqlalchemy import select
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_settings_export import api as _api

project_api = _project_api
api = _api


@pytest.mark.asyncio
async def test_discovery_keeps_the_draft_model_the_provider_omits(api, monkeypatch):
    client, sessions = api

    async def fetch(self, base_url, api_key):
        return [{"id": "vision"}]  # "draft" is missing from this listing

    monkeypatch.setattr(type(settings_router.provider_discovery), "_fetch_models", fetch)
    async with sessions() as session:
        provider = await session.scalar(select(ProviderModel).where(ProviderModel.name == "Local"))
        draft_id = (await session.get(ApplicationSettingsModel, "draft_model_id")).value
    response = await client.post(f"/settings/app/providers/{provider.id}/models/discover", headers=auth("a"))
    assert response.status_code == 200, response.text
    async with sessions() as session:
        names = set(await session.scalars(select(LLMModel.name).where(LLMModel.provider_id == provider.id)))
        assert "draft" in names
        assert (await session.get(ApplicationSettingsModel, "draft_model_id")).value == draft_id


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["study_chat", "image_generation"])
async def test_the_generic_setting_route_checks_policy_groups(api, key):
    client, sessions = api
    response = await client.put(
        f"/settings/app/{key}", headers=auth("a"), json={"value": {"enabled": True, "group_ids": ["no-such-group"]}}
    )
    assert response.status_code == 400, response.text
    assert "Unknown groups: no-such-group" in response.json()["detail"]
    async with sessions() as session:
        assert await session.get(ApplicationSettingsModel, key) is None
    accepted = await client.put(
        f"/settings/app/{key}", headers=auth("a"), json={"value": {"enabled": True, "group_ids": ["student"]}}
    )
    assert accepted.status_code == 200, accepted.text
