"""Self-imposed learning-mode lock (US-52.5): leaving the mode or revealing needs an override."""

import uuid

import pytest
from asterism.domains.chat.models import ChatModel
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from test_chat_models import new_chat
from test_learning_modes import mode_path, select_mode
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_skill_execution import finish
from test_tutor_hints import hint_level, raise_to, send

project_api = _project_api


async def put_mode(client, cid, mode, revision, **extra):
    return await client.put(
        mode_path(cid),
        headers=auth(),
        json={"learning_mode": mode, "expected_learning_mode_revision": revision, **extra},
    )


async def info(client, cid):
    return (await client.get(f"/chat/{cid}", headers=auth())).json()["info"]


async def locked_tutor_chat(client, sessions):
    chat = await new_chat(client, learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    assert chat["info"]["learning_mode_locked"] is False
    locked = await put_mode(client, cid, "tutor", 1, locked=True)
    assert locked.status_code == 200, locked.text
    assert locked.json()["learning_mode_locked"] is True
    assert locked.json()["learning_mode_revision"] == 2
    return cid, first


@pytest.mark.asyncio
async def test_lock_persists_and_is_owner_scoped(project_api):
    client, sessions, _ = project_api
    cid, _ = await locked_tutor_chat(client, sessions)
    assert (await info(client, cid))["learning_mode_locked"] is True
    listed = (await client.get("/chat/", headers=auth())).json()["chats"]
    assert next(chat for chat in listed if chat["id"] == cid)["learning_mode_locked"] is True
    other = await client.put(
        mode_path(cid),
        headers=auth("b"),
        json={"learning_mode": "tutor", "expected_learning_mode_revision": 2, "locked": False, "override_lock": True},
    )
    assert other.status_code == 404
    # Relocking, and omitting ``locked``, keep the lock and the revision.
    assert (await select_mode(client, cid, "tutor", 2))["learning_mode_revision"] == 2
    again = await put_mode(client, cid, "tutor", 2, locked=True)
    assert again.json()["learning_mode_revision"] == 2 and again.json()["learning_mode_locked"] is True


@pytest.mark.asyncio
async def test_standard_mode_cannot_be_locked(project_api):
    client, _, _ = project_api
    chat = await new_chat(client)
    cid = chat["info"]["id"]
    response = await put_mode(client, cid, "standard", 1, locked=True)
    assert response.status_code == 400
    assert (await info(client, cid))["learning_mode_locked"] is False


@pytest.mark.asyncio
async def test_switching_between_learning_modes_keeps_the_lock(project_api):
    client, sessions, _ = project_api
    cid, _ = await locked_tutor_chat(client, sessions)
    switched = await select_mode(client, cid, "review", 2)
    assert switched["learning_mode"] == "review" and switched["learning_mode_locked"] is True
    assert switched["learning_mode_revision"] == 3


@pytest.mark.asyncio
async def test_leaving_a_locked_mode_needs_the_override(project_api):
    client, sessions, _ = project_api
    cid, _ = await locked_tutor_chat(client, sessions)
    for body in ({}, {"locked": False}):
        refused = await put_mode(client, cid, "standard", 2, **body)
        assert refused.status_code == 409, refused.text
        assert "locked" in refused.json()["detail"]
    refused = await put_mode(client, cid, "tutor", 2, locked=False)
    assert refused.status_code == 409
    current = await info(client, cid)
    assert current["learning_mode"] == "tutor" and current["learning_mode_locked"] is True
    assert current["learning_mode_revision"] == 2
    # Selecting Standard releases the lock in the same change.
    left = await put_mode(client, cid, "standard", 2, override_lock=True)
    assert left.status_code == 200, left.text
    assert left.json()["learning_mode"] == "standard" and left.json()["learning_mode_locked"] is False


@pytest.mark.asyncio
async def test_unlocking_keeps_the_mode_and_needs_the_current_revision(project_api):
    client, sessions, _ = project_api
    cid, _ = await locked_tutor_chat(client, sessions)
    stale = await put_mode(client, cid, "tutor", 1, locked=False, override_lock=True)
    assert stale.status_code == 409
    unlocked = await put_mode(client, cid, "tutor", 2, locked=False, override_lock=True)
    assert unlocked.status_code == 200, unlocked.text
    assert unlocked.json()["learning_mode"] == "tutor" and unlocked.json()["learning_mode_locked"] is False
    assert unlocked.json()["learning_mode_revision"] == 3
    # Unlocked, Standard needs no override.
    assert (await select_mode(client, cid, "standard", 3))["learning_mode"] == "standard"


@pytest.mark.asyncio
async def test_a_locked_reveal_needs_the_override_but_hints_do_not(project_api):
    client, sessions, _ = project_api
    cid, first = await locked_tutor_chat(client, sessions)
    nudge = await raise_to(client, sessions, cid, first, "nudge")
    refused = await send(client, cid, nudge["id"], hint={"level": "answer", "confirm_reveal": True})
    assert refused.status_code == 409
    assert "locked" in refused.json()["detail"]
    assert await hint_level(client, cid) == "nudge"
    # The confirmation is still required alongside the override.
    unconfirmed = await send(client, cid, nudge["id"], hint={"level": "answer", "override_lock": True})
    assert unconfirmed.status_code == 400
    revealed = await raise_to(client, sessions, cid, nudge["id"], "answer", confirm_reveal=True, override_lock=True)
    assert revealed["learning_mode"]["hint_level"] == "answer"
    assert (await info(client, cid))["learning_mode_locked"] is True
    # A reset and a fresh raise are not gated.
    await raise_to(client, sessions, cid, revealed["id"], "hint", reset=True)
    assert await hint_level(client, cid) == "hint"


@pytest.mark.asyncio
async def test_an_unlocked_reveal_needs_no_override(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    await raise_to(client, sessions, cid, first, "answer", confirm_reveal=True)
    assert await hint_level(client, cid) == "answer"


@pytest.mark.asyncio
async def test_the_database_rejects_a_locked_standard_chat(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    async with sessions() as db:
        with pytest.raises(IntegrityError, match="chat_standard_mode_unlocked"):
            await db.execute(
                update(ChatModel).where(ChatModel.id == uuid.UUID(chat["info"]["id"])).values(learning_mode_locked=True)
            )
            await db.commit()
        await db.rollback()
