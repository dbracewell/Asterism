"""US-54.6: read a recorded run on any branch for run diff."""

import pytest
from test_chat_forks import LEAD, fork, recorded_run
from test_chat_forks import project_api as _project_api
from test_projects_api import auth

project_api = _project_api


async def run(client, chat_id, message_id, user="a"):
    return await client.get(f"/chat/{chat_id}/messages/{message_id}/run", headers=auth(user))


@pytest.mark.asyncio
async def test_a_run_reads_along_its_own_branch(project_api):
    client, sessions, _ = project_api
    chat_id, turn, step, final, _, _ = await recorded_run(client, sessions)
    forked = (await fork(client, chat_id, step.id, LEAD, "Be brief")).json()

    # The original branch is no longer active, but its run still reads whole.
    original = (await run(client, chat_id, final.id)).json()
    assert original["request"]["id"] == str(turn)
    assert [item["id"] for item in original["steps"]] == [str(step.id), str(final.id)]
    assert original["steps"][0]["delegations"][0]["execution_id"] == str(LEAD)
    # Any step of a run gives the same run.
    assert (await run(client, chat_id, step.id)).json() == original

    # The user turn follows the active branch, which is now the fork.
    active = (await run(client, chat_id, turn)).json()
    assert [item["id"] for item in active["steps"]] == [forked["id"]]
    assert (await run(client, chat_id, forked["id"])).json() == active


@pytest.mark.asyncio
async def test_runs_are_owner_only(project_api):
    client, sessions, _ = project_api
    chat_id, _, step, _, _, _ = await recorded_run(client, sessions)
    assert (await run(client, chat_id, step.id, user="b")).status_code == 404
    assert (await run(client, chat_id, chat_id)).status_code == 404
