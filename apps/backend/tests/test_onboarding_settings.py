"""US-61.4: per-user first-chat tour state in the user settings API."""

import pytest
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
TOUR = "/settings/user/first_chat_tour"


async def tour_state(client, user="a"):
    response = await client.get("/settings/user", headers=auth(user))
    assert response.status_code == 200, response.text
    return response.json()["first_chat_tour"]


@pytest.mark.asyncio
async def test_the_tour_is_offered_until_the_user_finishes_or_dismisses_it(project_api):
    client, _, _ = project_api
    assert await tour_state(client) is None

    for state in ("dismissed", "completed"):
        response = await client.put(TOUR, headers=auth(), json={"value": state})
        assert response.status_code == 200, response.text
        assert await tour_state(client) == state

    # The state is per user.
    assert await tour_state(client, "b") is None


@pytest.mark.asyncio
async def test_restarting_clears_the_recorded_state(project_api):
    client, _, _ = project_api
    await client.put(TOUR, headers=auth(), json={"value": "completed"})

    cleared = await client.put(TOUR, headers=auth(), json={"value": None})
    assert cleared.status_code == 200, cleared.text
    assert await tour_state(client) is None

    await client.put(TOUR, headers=auth(), json={"value": "dismissed"})
    deleted = await client.delete(TOUR, headers=auth())
    assert deleted.status_code == 200, deleted.text
    assert await tour_state(client) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["pending", "", True, 1, ["completed"], {"state": "completed"}])
async def test_only_known_tour_states_are_stored(project_api, value):
    client, _, _ = project_api
    response = await client.put(TOUR, headers=auth(), json={"value": value})
    assert response.status_code == 400
    bulk = await client.patch("/settings/user", headers=auth(), json={"values": {"first_chat_tour": value}})
    assert bulk.status_code == 400
    assert await tour_state(client) is None


@pytest.mark.asyncio
async def test_the_tour_state_requires_authentication(project_api):
    client, _, _ = project_api
    assert (await client.put(TOUR, json={"value": "completed"})).status_code in {401, 403}
