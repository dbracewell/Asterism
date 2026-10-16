"""Context identity, future memory boundaries, and persisted resume isolation."""

import uuid
from dataclasses import replace

import pytest
from asterism.core.exceptions import BadDataException, CodedException
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.context_provenance import DerivedContextKey, MemoryNamespace, describe_context
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.schemas import Chat
from asterism.domains.chat.service import get_one
from test_context_tools import add_file
from test_context_tools import context_runtime as _context_runtime
from test_execution_scope import make_scope
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
context_runtime = _context_runtime


def test_shared_agent_profile_never_implies_shared_context():
    scope, child, model = make_scope()
    scope = replace(scope, user_profile_id=uuid.uuid4(), project_instructions="PRIVATE instructions")
    other_project = replace(scope, project_id=uuid.uuid4())
    sibling = replace(scope, chat_id=uuid.uuid4())
    general = replace(scope, project_id=None)
    other_general = replace(general, chat_id=uuid.uuid4())
    assert MemoryNamespace.from_scope(scope) != MemoryNamespace.from_scope(other_project)
    assert MemoryNamespace.from_scope(scope) == MemoryNamespace.from_scope(sibling)
    assert DerivedContextKey.from_scope(scope) != DerivedContextKey.from_scope(sibling)
    assert MemoryNamespace.from_scope(general) != MemoryNamespace.from_scope(other_general)
    assert MemoryNamespace.from_scope(scope) != MemoryNamespace.from_scope(replace(scope, user_id="foreign"))
    assert MemoryNamespace.from_scope(scope) != MemoryNamespace.from_scope(replace(scope, user_profile_id=uuid.uuid4()))
    assert "PRIVATE" not in describe_context(scope).model_dump_json()
    delegated = scope.narrow_for_sub_agent(
        agent_id=child, executed_model=model, configuration_revision=9, effective_internal_tools=frozenset()
    )
    trace = describe_context(delegated)
    assert trace.selected_model.id == scope.selected_model.id
    assert trace.executed_model.provider_id == model.provider_id
    assert [value.agent_id for value in trace.configurations] == [scope.agent_id, child]
    assert [value.revision for value in trace.configurations] == [scope.configuration_revision, 9]
    assert trace.selected_sub_agent_ids == (child,)


@pytest.mark.parametrize(
    "change",
    [
        {"active_branch_message_ids": (uuid.uuid4(),)},
        {"allowed_file_ids": frozenset()},
        {"prompt_revision": 10},
        {"configuration_revision": 10},
        {"eligible_sub_agent_ids": frozenset()},
        {"effective_internal_tools": frozenset()},
        {"project_id": None},
    ],
)
def test_derived_context_key_changes_with_source_scope(change):
    scope, _, _ = make_scope()
    assert DerivedContextKey.from_scope(scope) != DerivedContextKey.from_scope(replace(scope, **change))
    # Stable across serialization/restart and set ordering, independent of run ID.
    key = DerivedContextKey.from_scope(scope)
    assert DerivedContextKey.model_validate_json(key.model_dump_json()) == key
    assert DerivedContextKey.from_scope(replace(scope, execution_id=uuid.uuid4())) == key


@pytest.mark.asyncio
async def test_resume_ceiling_restart_move_and_removal(context_runtime):
    r = context_runtime
    original = await add_file(r)
    response = await r.client.post(
        "/chat/",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Private history remains",
            "model_id": str(uuid.UUID(int=2)),
            "project_id": r.p["id"],
        },
    )
    assert response.status_code == 200, response.text
    chat = Chat.model_validate(response.json())
    cid, mid = chat.info.id, chat.messages[0].id
    first = await prepare_execution(user_id="a", chat_id=cid, message_id=mid)
    assert first.context.allowed_file_ids == (original,)
    assert first.context.executed_model.provider_id == first.model.provider_id
    assert "Private history remains" not in first.context.model_dump_json()
    added = await add_file(r)
    # A new Agent/DB session simulates process restart, not object reuse.
    reopened = await get_one(user_id="a", chat_id=cid)
    agent = Agent(profile=r.profile, user=r.user, session=reopened, model_id=first.model.id)
    replay = await agent.prepare_execution(mid)
    scope = await agent.prepare_execution_scope()
    await agent._get_client()
    assert agent.execution_scope.executed_model.provider_id == first.model.provider_id
    assert agent.execution_scope.executed_model.name == first.model.name
    assert replay == first
    assert scope.allowed_file_ids == {original}
    assert added not in scope.allowed_file_ids
    fresh = await agent.prepare_execution(mid, restart=True)
    scope = await agent.prepare_execution_scope()
    assert fresh.context.allowed_file_ids == tuple(sorted((original, added), key=str))
    assert scope.allowed_file_ids == {original, added}
    assert fresh.context.scope_revision != first.context.scope_revision
    move = await r.client.patch(f"/chat/{cid}/project", headers=auth(), json={"project_id": r.q["id"]})
    assert move.status_code == 200, move.text
    with pytest.raises(CodedException, match="project changed"):
        await prepare_execution(user_id="a", chat_id=cid, message_id=mid)
    with pytest.raises(BadDataException, match="context changed"):
        await agent.prepare_execution_scope()
    moved = await get_one(user_id="a", chat_id=cid)
    assert moved.messages[0].content == "Private history remains"
    later = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True)
    assert later.context.project_id == uuid.UUID(r.q["id"])
    assert original not in later.context.allowed_file_ids
    current = (await r.client.get(f"/projects/{r.q['id']}", headers=auth())).json()
    deleted = await r.client.delete(
        f"/projects/{r.q['id']}?expected_context_revision={current['context_revision']}", headers=auth()
    )
    assert deleted.status_code == 200, deleted.text
    with pytest.raises(CodedException, match="project changed"):
        await prepare_execution(user_id="a", chat_id=cid, message_id=mid)
    general = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True)
    assert general.context.project_id is None
    assert (await get_one(user_id="a", chat_id=cid)).messages[0].content == "Private history remains"
