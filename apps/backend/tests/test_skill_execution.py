"""Atomic acceptance, pinned per-branch instructions and live authorization."""

import uuid

import pytest
from asterism.core.exceptions import CodedException
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.schemas import MessageStatus
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from test_chat_models import A, new_chat
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_skills import ASSIGNMENTS, POLICY, create, document
from test_skills import skills_api as _skills_api

project_api = _project_api
skills_api = _skills_api


async def setup(client, count=1):
    skills = [await create(client, f"skill-{i}", body=f"Private instructions {i}") for i in range(count)]
    state = (await client.get(ASSIGNMENTS, headers=auth())).json()
    result = await client.put(
        ASSIGNMENTS,
        headers=auth(),
        json={"skill_ids": [s["id"] for s in skills], "expected_revision": state["revision"]},
    )
    assert result.status_code == 200, result.text
    assert (await client.put(POLICY, headers=auth("admin"), json={"enabled": True})).status_code == 200
    return skills


def selection(ids, revision=0, refresh=()):
    return {"expected_revision": revision, "skill_ids": ids, "refresh_ids": list(refresh)}


async def finish(sessions, mid):
    async with sessions() as db:
        await db.execute(
            update(MessageModel).where(MessageModel.id == uuid.UUID(mid)).values(status=MessageStatus.COMPLETED)
        )
        await db.commit()


async def send(client, cid, parent, skills=None, request_id=None):
    payload = {
        "request_id": request_id or str(uuid.uuid4()),
        "user_prompt": "Follow up",
        "parent_message_id": parent,
        "expected_model_revision": 1,
    }
    if skills is not None:
        payload["skills"] = skills
    return await client.post(f"/chat/{cid}/message", headers=auth(), json=payload)


@pytest.mark.asyncio
async def test_pinning_refresh_removal_replay_and_private_provenance(skills_api):
    client, sessions, _ = skills_api
    a, b = await setup(client, 2)
    chat = await new_chat(client, skills=selection([b["id"], a["id"]]))
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    state = chat["info"]["active_skills"]
    assert [s["id"] for s in state["skills"]] == [b["id"], a["id"]]
    assert "Private instructions" not in str(chat)
    assert (
        await client.put(
            f"/skills/{a['id']}",
            headers=auth(),
            json={"expected_revision": 1, "content": document("renamed", body="NEW instructions")},
        )
    ).status_code == 200
    async with sessions() as db:
        args = dict(user_id="a", chat_id=uuid.UUID(cid), message_id=uuid.UUID(first), session=db)
        run = await prepare_execution(**args)
        prompt = (await db.get(MessageModel, uuid.UUID(first))).pending_prompt
        assert [s.id for s in run.skills] == [uuid.UUID(b["id"]), uuid.UUID(a["id"])]
        assert "Private instructions 0" in prompt.text and "NEW instructions" not in prompt.text
        assert [layer.kind for layer in prompt.layers] == ["platform", "agent", "profile", "skills", "runtime"]
        assert await prepare_execution(**args) == run
        regenerated = await prepare_execution(**args, restart=True)
        assert regenerated.skills == run.skills and regenerated.id != run.id
        assert run.configuration.tools == regenerated.configuration.tools
    await finish(sessions, first)
    second = await send(client, cid, first)
    assert second.status_code == 200, second.text
    assert second.json()["skills"][1]["revision"] == 1
    await finish(sessions, second.json()["id"])
    info = (await client.get(f"/chat/{cid}", headers=auth())).json()["info"]["active_skills"]
    assert info["skills"][1]["update_available"] is True
    third = await send(client, cid, second.json()["id"], selection([a["id"], b["id"]], state["revision"], [a["id"]]))
    assert third.status_code == 200, third.text
    assert third.json()["skills"][0]["revision"] == 2
    await finish(sessions, third.json()["id"])
    info = (await client.get(f"/chat/{cid}", headers=auth())).json()["info"]["active_skills"]
    rid = str(uuid.uuid4())
    removed = await send(client, cid, third.json()["id"], selection([], info["revision"]), rid)
    assert removed.status_code == 200 and removed.json()["skills"] == []
    assert (await send(client, cid, third.json()["id"], selection([], info["revision"]), rid)).json() == removed.json()
    assert (await send(client, cid, third.json()["id"], selection([a["id"]], info["revision"]), rid)).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("revocation", ["policy", "assignment", "delete"])
@pytest.mark.parametrize("started", [False, True])
async def test_revocation_blocks_replay_and_followup_allows_removal(skills_api, revocation, started):
    client, sessions, _ = skills_api
    (skill,) = await setup(client)
    chat = await new_chat(client, skills=selection([skill["id"]]))
    cid, mid = chat["info"]["id"], chat["messages"][0]["id"]
    if started:
        async with sessions() as db:
            await prepare_execution(user_id="a", chat_id=uuid.UUID(cid), message_id=uuid.UUID(mid), session=db)
    if revocation == "policy":
        await client.put(POLICY, headers=auth("admin"), json={"enabled": False})
    elif revocation == "assignment":
        assignments = (await client.get(ASSIGNMENTS, headers=auth())).json()
        await client.put(
            ASSIGNMENTS, headers=auth(), json={"skill_ids": [], "expected_revision": assignments["revision"]}
        )
    else:
        await client.delete(f"/skills/{skill['id']}?expected_revision=1", headers=auth())
    async with sessions() as db:
        for restart in (False, True):
            with pytest.raises(CodedException):
                await prepare_execution(
                    user_id="a", chat_id=uuid.UUID(cid), message_id=uuid.UUID(mid), restart=restart, session=db
                )
        assert (await db.get(MessageModel, uuid.UUID(mid))).accepted_skills.snapshots[0].content == skill["content"]
    await finish(sessions, mid)
    assert (await send(client, cid, mid)).status_code == 409
    info = (await client.get(f"/chat/{cid}", headers=auth())).json()["info"]["active_skills"]
    assert info["skills"][0]["available"] is False
    assert (await send(client, cid, mid, selection([], info["revision"]))).status_code == 200


@pytest.mark.asyncio
async def test_invalid_selection_atomicity_stale_foreign_duplicates_and_forgery(skills_api):
    client, sessions, _ = skills_api
    a, b = await setup(client, 2)
    foreign = await create(client, "foreign", user="b")
    for value, status in [
        (selection([foreign["id"]]), 409),
        (selection([str(uuid.uuid4())]), 409),
        (selection([a["id"], a["id"]]), 422),
        (selection([a["id"]], 1), 409),
        (selection([a["id"]], refresh=[b["id"]]), 422),
        ({**selection([a["id"]]), "content": "forged"}, 422),
    ]:
        response = await client.post(
            "/chat/",
            headers=auth(),
            json={"request_id": str(uuid.uuid4()), "model_id": A, "user_prompt": "test", "skills": value},
        )
        assert response.status_code == status, response.text
    chat = await new_chat(client, skills=selection([a["id"]]))
    cid, mid = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, mid)
    assert (await send(client, cid, mid, selection([b["id"]], 0))).status_code == 409
    current = (await client.get(f"/chat/{cid}", headers=auth())).json()
    assert len(current["messages"]) == 1 and current["info"]["active_skills"] == chat["info"]["active_skills"]
    async with sessions() as db:
        with pytest.raises(IntegrityError):
            await db.execute(
                update(MessageModel)
                .where(MessageModel.id == uuid.UUID(mid))
                .values(accepted_skills={"revision": 0, "snapshots": []})
            )
            await db.commit()
        await db.rollback()


@pytest.mark.asyncio
async def test_branch_restore_fork_and_other_chat_isolation(skills_api):
    from asterism.domains.chat.schemas import NewMessageRequest, UpdateMessageRequest
    from asterism.domains.chat.service import add_message, get_one, update_message

    client, sessions, _ = skills_api
    (a,) = await setup(client)
    chat = await new_chat(client, skills=selection([a["id"]]))
    cid, root = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    assistant = await add_message(
        "a",
        cid,
        NewMessageRequest(
            model_id=uuid.UUID(A),
            role="assistant",
            content="Answer",
            parent_message_id=root,
            status=MessageStatus.COMPLETED,
        ),
    )
    dropped = await send(client, str(cid), str(assistant.id), selection([], 1))
    assert dropped.status_code == 200
    assert (await get_one(cid, "a")).info.active_skills.skills == []
    # An assistant fork from root must restore root's state even while the other branch has removed it.
    alternative = await add_message(
        "a",
        cid,
        NewMessageRequest(
            model_id=uuid.UUID(A),
            role="assistant",
            content="Alternate",
            parent_message_id=root,
            status=MessageStatus.COMPLETED,
        ),
    )
    restored = (await get_one(cid, "a")).info.active_skills
    assert [s.id for s in restored.skills] == [uuid.UUID(a["id"])]
    followed = await send(client, str(cid), str(alternative.id))
    assert followed.status_code == 200 and followed.json()["skills"][0]["id"] == a["id"]
    await update_message("a", cid, root, UpdateMessageRequest(active_child_id=assistant.id))
    assert (await get_one(cid, "a")).info.active_skills.skills == []
    independent = await new_chat(client)
    assert independent["info"]["active_skills"]["skills"] == []
    assert (await client.get(f"/chat/{cid}", headers=auth("b"))).status_code == 404


@pytest.mark.asyncio
async def test_aggregate_budget_and_count_reject_without_acceptance(skills_api):
    client, _, _ = skills_api
    skills = await setup(client, 3)
    for item in skills:
        response = await client.put(
            f"/skills/{item['id']}",
            headers=auth(),
            json={"expected_revision": 1, "content": document(item["name"], body="é" * 24000)},
        )
        assert response.status_code == 200
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": A,
            "request_id": str(uuid.uuid4()),
            "user_prompt": "test",
            "skills": selection([s["id"] for s in skills]),
        },
    )
    assert response.status_code == 422 and "131072" in response.text
    response = await client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": A,
            "request_id": str(uuid.uuid4()),
            "user_prompt": "test",
            "skills": selection([str(uuid.uuid4()) for _ in range(9)]),
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_streaming_output_rechecks_skill_policy(skills_api, monkeypatch):
    from unittest.mock import AsyncMock

    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.service import get_one
    from asterism.domains.llm.schemas import LLMEvent, LLMEventType

    client, _, _ = skills_api
    (a,) = await setup(client)
    chat = await new_chat(client, skills=selection([a["id"]]))
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    agent = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=await get_one(cid, "a"),
        model_id=uuid.UUID(A),
    )
    await agent.prepare_execution(mid)
    await agent.prepare_execution_scope()

    class Client:
        async def chat(self, **kwargs):
            yield LLMEvent(type=LLMEventType.TEXT_DELTA, content="First")
            yield LLMEvent(type=LLMEventType.TEXT_DELTA, content="Must not be released")

    monkeypatch.setattr(agent, "_get_client", AsyncMock(return_value=Client()))
    stream = agent.run([])
    assert (await anext(stream)).content == "First"
    await client.put(POLICY, headers=auth("admin"), json={"enabled": False})
    with pytest.raises(CodedException, match="Skills are disabled"):
        await anext(stream)
    await stream.aclose()


@pytest.mark.asyncio
async def test_project_skills_do_not_inherit_to_delegated_agents(skills_api, monkeypatch):
    from dataclasses import replace

    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.execution_scope import ModelIdentity
    from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
    from asterism.domains.chat.service import get_one
    from test_project_sub_agents import runtime_setup

    client, _, project, _, worker, _, _ = await runtime_setup(skills_api, monkeypatch)
    (a,) = await setup(client)
    chat = await new_chat(client, project_id=project["id"], skills=selection([a["id"]]))
    main = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=await get_one(uuid.UUID(chat["info"]["id"]), "a"),
        model_id=uuid.UUID(A),
    )
    await main.prepare_execution(uuid.UUID(chat["messages"][0]["id"]))
    scope = await main.prepare_execution_scope()
    assert "Private instructions 0" in await main._build_system_prompt()
    profile = await get_agent_profile("a", uuid.UUID(worker["id"]))
    child_scope = scope.narrow_for_sub_agent(
        agent_id=profile.id,
        executed_model=ModelIdentity(id=profile.model_id),
        configuration_revision=profile.config_revision,
        effective_internal_tools=frozenset(),
    )
    child = Agent(
        profile=profile,
        user=main.user,
        session=main.session,
        execution_scope=child_scope,
        tool_scope=replace(main.tool_scope, caller_agent_id=profile.id, model_id=profile.model_id),
    )
    text = await child._build_system_prompt()
    assert "Private instructions 0" not in text and "[skills instructions]" not in text
    assert child_scope.allowed_file_ids <= scope.allowed_file_ids
    assert not child_scope.effective_internal_tools


@pytest.mark.asyncio
async def test_skill_only_send_and_failed_selection_preserves_draft(skills_api):
    client, sessions, _ = skills_api
    (a,) = await setup(client)
    chat = await new_chat(client, user_prompt="", skills=selection([a["id"]]))
    assert chat["messages"][0]["content"] == ""
    cid, mid = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, mid)
    draft = await client.post("/chat/drafts", headers=auth(), json={"chat_id": cid})
    assert draft.status_code == 200, draft.text
    request = {
        "user_prompt": "",
        "skills": selection([a["id"]], 0),
        "expected_model_revision": 1,
        "parent_message_id": mid,
        "draft_id": draft.json()["id"],
        "request_id": str(uuid.uuid4()),
    }
    rejected = await client.post(f"/chat/{cid}/message", headers=auth(), json=request)
    assert rejected.status_code == 409, rejected.text
    assert (await client.get(f"/chat/drafts/{draft.json()['id']}", headers=auth())).status_code == 200
    request["skills"] = selection([a["id"]], 1)
    accepted = await client.post(f"/chat/{cid}/message", headers=auth(), json=request)
    assert accepted.status_code == 200, accepted.text
    assert (await client.get(f"/chat/drafts/{draft.json()['id']}", headers=auth())).status_code == 404
