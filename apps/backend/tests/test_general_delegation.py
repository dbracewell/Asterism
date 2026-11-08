"""US-68.1: the main agent delegates in General chats to an explicit, live General set (ADR-0059)."""

import uuid
from dataclasses import replace

import pytest
from asterism.core.exceptions import BadDataException
from asterism.domains.agent.capabilities import CapabilityGrant
from asterism.domains.agent.models import GeneralSubAgentModel
from asterism.domains.agent.schemas import SubAgentTraceCreate
from asterism.domains.agent.service import create_sub_agent_trace
from asterism.domains.chat.capabilities import sub_agent_entries
from asterism.domains.chat.delegation import (
    eligible_delegation_targets,
    require_delegation_target,
    resolve_delegation_scope,
)
from asterism.domains.chat.models import ChatModel
from asterism.domains.chat.schemas import Chat
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from test_context_tools import add_file, context_runtime, resolve
from test_project_sub_agents import worker
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
runtime = context_runtime
URL = "/settings/user/main-agent/general-sub-agents"


async def put(client, ids, revision=1, user="a"):
    return await client.put(URL, headers=auth(user), json={"agent_ids": ids, "expected_revision": revision})


async def general_chat(r, files=()):
    response = await r.client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Hello",
            "model_id": str(uuid.UUID(int=2)),
            "files": [str(file_id) for file_id in files],
        },
    )
    assert response.status_code == 200, response.text
    return Chat.model_validate(response.json()).info.id


async def test_the_set_is_ordered_owned_and_revision_guarded(runtime):
    r = runtime
    client = r.client
    assert (await client.get(URL, headers=auth())).json() == {"revision": 1, "agents": []}
    c = await worker(client, "Third")
    foreign = await worker(client, "Theirs", user="b")
    main = (await client.get("/settings/user/main-agent", headers=auth())).json()

    for invalid in [foreign["id"], main["id"], str(uuid.uuid4())]:
        assert (await put(client, [r.a["id"], invalid])).status_code == 404
    assert (await put(client, [r.a["id"], r.a["id"]])).status_code == 400
    assert (await client.get(URL, headers=auth())).json()["revision"] == 1

    saved = await put(client, [c["id"], r.a["id"]])
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 2
    assert [agent["id"] for agent in saved.json()["agents"]] == [c["id"], r.a["id"]]
    assert saved.json()["agents"][0]["model_available"] is True
    assert (await put(client, [r.a["id"]], revision=1)).status_code == 409
    # Saving the same list again changes nothing.
    assert (await put(client, [c["id"], r.a["id"]], revision=2)).json()["revision"] == 2
    # Another user sees only their own (empty) set.
    assert (await client.get(URL, headers=auth("b"))).json() == {"revision": 1, "agents": []}

    # Deleting a definition takes it out of the set and bumps the revision.
    assert (await client.delete(f"/agents/sub-agents/{c['id']}", headers=auth())).status_code == 200
    after = (await client.get(URL, headers=auth())).json()
    assert after["revision"] == 3 and [agent["id"] for agent in after["agents"]] == [r.a["id"]]


async def test_the_database_admits_only_the_owners_sub_agents(runtime):
    r = runtime
    main = (await r.client.get("/settings/user/main-agent", headers=auth())).json()
    for user_id, agent_id in [("b", r.a["id"]), ("a", main["id"])]:
        async with r.sessions() as db:
            db.add(GeneralSubAgentModel(user_id=user_id, agent_id=uuid.UUID(agent_id), position=0))
            with pytest.raises(IntegrityError):
                await db.commit()


async def test_no_set_means_no_sub_agent_tool_in_general_chats(runtime):
    r = runtime
    chat_id = await general_chat(r)
    names, ceiling = await resolve(r.__class__(**{**vars(r), "chat_id": chat_id}))
    assert "sub_agent" not in names
    assert ceiling.delegation.source == "general" and ceiling.delegation.agent_ids == frozenset()


async def test_a_general_set_offers_delegation_and_records_its_source(runtime):
    r = runtime
    assert (await put(r.client, [r.a["id"]])).status_code == 200
    chat_id = await general_chat(r)
    names, ceiling = await resolve(r.__class__(**{**vars(r), "chat_id": chat_id}))
    assert "sub_agent" in names
    scope = ceiling.delegation
    assert (scope.project_id, scope.context_revision, scope.agent_ids) == (None, 2, frozenset({uuid.UUID(r.a["id"])}))
    target = await require_delegation_target(user_id="a", chat_id=chat_id, scope=scope, target_id=uuid.UUID(r.a["id"]))
    assert target.model_id == uuid.UUID(int=1)
    # The other user's project selections don't leak into General chats.
    with pytest.raises(BadDataException, match="not selected"):
        await require_delegation_target(user_id="a", chat_id=chat_id, scope=scope, target_id=uuid.UUID(r.b["id"]))

    async with r.sessions() as db:
        [entry] = await sub_agent_entries(
            user_id="a", chat_id=chat_id, caller_id=r.profile.id, delegation=scope, session=db
        )
    assert entry.grants == [CapabilityGrant.GENERAL_SELECTION]

    trace = await create_sub_agent_trace(
        SubAgentTraceCreate(
            user_id="a",
            sub_agent_id=uuid.UUID(r.a["id"]),
            sub_agent_name="Allowed",
            task_digest="0" * 64,
            delegation_scope=scope.source,
        ),
        session=None,
    )
    assert trace.delegation_scope == "general"


async def test_changing_the_set_mid_turn_refuses_the_next_delegation(runtime):
    r = runtime
    await put(r.client, [r.a["id"], r.b["id"]])
    chat_id = await general_chat(r)
    _, ceiling = await resolve(r.__class__(**{**vars(r), "chat_id": chat_id}))
    await put(r.client, [r.b["id"]], revision=2)
    with pytest.raises(BadDataException, match="start a new turn"):
        await require_delegation_target(
            user_id="a", chat_id=chat_id, scope=ceiling.delegation, target_id=uuid.UUID(r.b["id"])
        )
    # A new turn sees the new set.
    live = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    assert live.agent_ids == frozenset({uuid.UUID(r.b["id"])})


async def test_moving_a_chat_between_general_and_a_project_switches_its_source(runtime):
    r = runtime
    await put(r.client, [r.b["id"]])
    chat_id = await general_chat(r)
    general = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    async with r.sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(project_id=uuid.UUID(r.p["id"])))
        await db.commit()
    with pytest.raises(BadDataException, match="start a new turn"):
        await require_delegation_target(user_id="a", chat_id=chat_id, scope=general, target_id=uuid.UUID(r.b["id"]))
    project = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    assert project.source == "project" and project.agent_ids == frozenset({uuid.UUID(r.a["id"])})


async def test_an_unavailable_fixed_model_blocks_that_target_only(runtime):
    r = runtime
    await put(r.client, [r.a["id"]])
    chat_id = await general_chat(r)
    scope = await resolve_delegation_scope(user_id="a", chat_id=chat_id)
    from asterism.domains.settings.models import LLMModel

    async with r.sessions() as db:
        await db.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(int=1)).values(is_active=False))
        await db.commit()
    assert await eligible_delegation_targets(user_id="a", chat_id=chat_id, scope=scope) == []
    with pytest.raises(BadDataException, match="unavailable"):
        await require_delegation_target(user_id="a", chat_id=chat_id, scope=scope, target_id=uuid.UUID(r.a["id"]))


async def test_a_child_in_a_general_chat_sees_only_the_chats_attachments(runtime):
    r = runtime
    await put(r.client, [r.a["id"]])
    attached = await add_file(r, project=False)
    project_file = await add_file(r, project=True)
    chat_id = await general_chat(r, files=[attached])
    _, ceiling = await resolve(r.__class__(**{**vars(r), "chat_id": chat_id}))
    assert ceiling.project_id is None
    assert ceiling.file_ids == frozenset({attached})
    assert project_file not in ceiling.file_ids

    # The child inherits the same ceiling and can't resolve a wider one.
    from asterism.domains.agent.service import get_agent_profile
    from asterism.domains.chat.tool_policy import resolve_effective_tools

    child = await get_agent_profile("a", uuid.UUID(r.a["id"]))
    child_ceiling = replace(ceiling, caller_agent_id=child.id, model_id=child.model_id)
    _, inherited = await resolve_effective_tools(
        user_id="a", chat_id=chat_id, profile=child, model_id=uuid.UUID(int=1), ceiling=child_ceiling
    )
    assert inherited.file_ids == frozenset({attached})
    _, none = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=child, model_id=uuid.UUID(int=1))
    assert none is None
    async with r.sessions() as db:
        assert (await db.scalars(select(GeneralSubAgentModel.agent_id))).all() == [uuid.UUID(r.a["id"])]
