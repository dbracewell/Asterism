"""US-101.2: the setup walkthrough's progress is kept on the server, per installation."""

import pytest
from asterism.domains.settings.models import ApplicationSettingsModel
from test_projects_api import auth
from test_settings_export import api as _api
from test_settings_export import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
api = _api
PATH = "/settings/app/setup"


async def test_steps_are_recorded_reopened_and_shared_by_admins(api):
    client, _ = api  # In this fixture "a" is the administrator.
    assert (await client.get(PATH, headers=auth("a"))).json() == {"steps": {}}

    done = await client.put(f"{PATH}/steps/providers", headers=auth("a"), json={"state": "done"})
    assert done.status_code == 200, done.text
    skipped = await client.put(f"{PATH}/steps/memory", headers=auth("a"), json={"state": "skipped"})
    steps = skipped.json()["steps"]
    assert (steps["providers"]["state"], steps["memory"]["state"]) == ("done", "skipped")
    assert steps["providers"]["by"] == "a" and steps["providers"]["at"] > 0

    reopened = await client.put(f"{PATH}/steps/memory", headers=auth("a"), json={"state": None})
    assert set(reopened.json()["steps"]) == {"providers"}
    assert set((await client.get(PATH, headers=auth("a"))).json()["steps"]) == {"providers"}


async def test_only_admins_and_known_step_names(api):
    client, _ = api
    assert (await client.get(PATH, headers=auth("b"))).status_code == 403
    assert (await client.put(f"{PATH}/steps/memory", headers=auth("b"), json={"state": "done"})).status_code == 403
    assert (
        await client.put(f"{PATH}/steps/Not%20a%20step", headers=auth("a"), json={"state": "done"})
    ).status_code == 400
    assert (await client.put(f"{PATH}/steps/memory", headers=auth("a"), json={"state": "maybe"})).status_code == 422


async def test_malformed_progress_reads_as_not_reviewed(api):
    client, sessions = api
    async with sessions() as session:
        session.add(ApplicationSettingsModel(key="setup_progress", value={"steps": "nope"}))
        await session.commit()
    assert (await client.get(PATH, headers=auth("a"))).json() == {"steps": {}}
