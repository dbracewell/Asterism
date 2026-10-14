import uuid

import pytest
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, ProviderModel
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


@pytest.mark.asyncio
async def test_main_settings_and_distinct_sub_agent_api_contracts(project_api):
    client, sessions, _ = project_api
    main = (await client.get("/settings/user/main-agent", headers=auth())).json()
    other = (await client.get("/settings/user/main-agent", headers=auth("b"))).json()
    assert main["id"] != other["id"]
    assert "model_id" not in main
    assert (await client.get("/agents", headers=auth())).status_code == 404
    assert (await client.post("/agents", headers=auth(), json={})).status_code == 404
    for invalid in [
        {"model_id": str(uuid.uuid4())},
        {"max_steps": 0},
        {"chat_parameters": {"extra_body": {"model": "x"}}},
    ]:
        assert (await client.put("/settings/user/main-agent", headers=auth(), json=invalid)).status_code == 422
    assert (await client.delete(f"/agents/sub-agents/{main['id']}", headers=auth())).status_code == 400
    assert (
        await client.put("/settings/user/default_agent_id", headers=auth(), json={"value": main["id"]})
    ).status_code == 400
    edited = await client.put(
        "/settings/user/main-agent",
        headers=auth(),
        json={"system_prompt": "Be precise", "max_steps": 8},
    )
    assert edited.status_code == 200
    settings = (await client.get("/settings/user", headers=auth())).json()
    assert settings["main_agent"]["system_prompt"] == "Be precise"
    assert "default_agent_id" not in settings and "agents" not in settings
    assert settings["sub_agents"] == {}
    assert (await client.get("/settings/user/main-agent", headers=auth("b"))).json() == other

    async with sessions() as session:
        provider = ProviderModel(name="Provider", base_url="http://localhost/v1", api_key="key")
        session.add(provider)
        await session.flush()
        model = LLMModel(name="Worker model", provider_id=provider.id, is_active=True)
        session.add_all([model, ApplicationSettingsModel(key="active_tools", value=[])])
        await session.commit()
        model_id = str(model.id)
    worker = {"name": "Research", "description": "Facts", "model_id": model_id, "system_prompt": "Research"}
    assert (await client.post("/agents/sub-agents", headers=auth(), json={"name": "Missing model"})).status_code == 422
    assert (
        await client.post("/agents/sub-agents", headers=auth(), json={**worker, "tools": ["unknown"]})
    ).status_code == 400
    created = await client.post("/agents/sub-agents", headers=auth(), json=worker)
    assert created.status_code == 201, created.text
    sub = created.json()
    assert sub["model_id"] == model_id and sub["model_available"]
    assert (await client.get("/agents/sub-agents", headers=auth("b"))).json() == []
    path = f"/agents/sub-agents/{sub['id']}"
    assert (await client.put(path, headers=auth("b"), json=worker)).status_code == 401
    assert (await client.put(path, headers=auth(), json={**worker, "name": "Revised"})).json()["name"] == "Revised"
    assert (await client.put(f"/agents/sub-agents/{main['id']}", headers=auth(), json=worker)).status_code == 400
    assert (await client.delete(path, headers=auth("b"))).status_code == 401
    assert (await client.delete(path, headers=auth())).status_code == 200
    assert (await client.get("/agents/sub-agents", headers=auth())).json() == []
