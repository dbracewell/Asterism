import uuid
from types import SimpleNamespace

import pytest
from asterism.core.exceptions import BadDataException
from asterism.domains.agent.execution_scope import (
    ChatScopeSnapshot,
    ExecutionScope,
    FileProvenance,
    ModelIdentity,
    ProjectScopeSnapshot,
    resolve_execution_scope,
)


def make_scope() -> tuple[ExecutionScope, uuid.UUID, ModelIdentity]:
    main_id = uuid.uuid4()
    child_id = uuid.uuid4()
    model = ModelIdentity(id=uuid.uuid4(), provider_id=uuid.uuid4(), name="selected")
    return (
        ExecutionScope(
            user_id="user",
            user_profile_id=None,
            agent_id=main_id,
            is_sub_agent=False,
            chat_id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            selected_model=model,
            executed_model=model,
            eligible_sub_agent_ids=frozenset({child_id}),
            effective_internal_tools=frozenset({"search_knowledge", "sub_agent"}),
            active_branch_message_ids=(uuid.uuid4(),),
            configuration_revision=2,
            prompt_revision=3,
            allowed_file_ids=frozenset({uuid.uuid4()}),
            file_provenance=(),
        ),
        child_id,
        ModelIdentity(id=uuid.uuid4(), provider_id=uuid.uuid4(), name="child"),
    )


def test_narrow_for_sub_agent_preserves_scope_and_cannot_add_internal_tools() -> None:
    scope, child_id, child_model = make_scope()

    narrowed = scope.narrow_for_sub_agent(
        agent_id=child_id,
        executed_model=child_model,
        configuration_revision=4,
        effective_internal_tools=frozenset({"search_knowledge"}),
    )

    assert narrowed.user_id == scope.user_id
    assert narrowed.chat_id == scope.chat_id
    assert narrowed.project_id == scope.project_id
    assert narrowed.allowed_file_ids == scope.allowed_file_ids
    assert narrowed.selected_model == scope.selected_model
    assert narrowed.executed_model == child_model
    assert narrowed.effective_internal_tools == frozenset({"search_knowledge"})
    assert narrowed.eligible_sub_agent_ids == frozenset()
    assert narrowed.configuration_revision == 4

    with pytest.raises(BadDataException, match="cannot add internal tools"):
        scope.narrow_for_sub_agent(
            agent_id=child_id,
            executed_model=child_model,
            configuration_revision=4,
            effective_internal_tools=frozenset({"search_knowledge", "delegate_new"}),
        )


async def resolve(chat_id, chat_snapshot, project_snapshot=None, agent_id=None):
    async def chat_reader():
        return chat_snapshot

    async def project_reader(_project_id):
        return project_snapshot

    return await resolve_execution_scope(
        user_id="user",
        user_profile_id=None,
        agent_id=agent_id or uuid.uuid4(),
        is_sub_agent=False,
        chat_id=chat_id,
        selected_model=None,
        executed_model=None,
        effective_internal_tools=frozenset(),
        configuration_revision=1,
        chat_scope_reader=chat_reader,
        project_scope_reader=project_reader,
    )


@pytest.mark.asyncio
async def test_empty_general_scope_has_no_files_or_delegation_targets():
    chat_id = uuid.uuid4()
    scope = await resolve(chat_id, ChatScopeSnapshot(chat_id, None, (), ()))

    assert scope.project_id is None
    assert scope.allowed_file_ids == frozenset()
    assert scope.eligible_sub_agent_ids == frozenset()
    assert scope.prompt_revision is None


@pytest.mark.asyncio
async def test_same_agent_in_two_chats_gets_distinct_scopes_with_merged_provenance():
    agent_id, project_id = uuid.uuid4(), uuid.uuid4()
    shared, local, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    message = uuid.uuid4()
    first_chat, second_chat = uuid.uuid4(), uuid.uuid4()
    project = ProjectScopeSnapshot(project_id, 4, frozenset(), (FileProvenance(shared, ("project",)),))
    first = await resolve(
        first_chat,
        ChatScopeSnapshot(
            first_chat,
            project_id,
            (message,),
            (FileProvenance(shared, ("chat",), (message,)), FileProvenance(local, ("chat",), (message,))),
        ),
        project,
        agent_id,
    )
    second = await resolve(
        second_chat,
        ChatScopeSnapshot(second_chat, None, (), (FileProvenance(other, ("chat",)),)),
        None,
        agent_id,
    )

    assert first.agent_id == second.agent_id
    assert first.allowed_file_ids == {shared, local}
    assert second.allowed_file_ids == {other}
    assert first.allowed_file_ids.isdisjoint(second.allowed_file_ids)
    provenance = {file.file_id: file for file in first.file_provenance}
    assert provenance[shared].sources == ("project", "chat")
    assert provenance[local].sources == ("chat",)
    assert first.prompt_revision == 4


@pytest.mark.asyncio
async def test_resolver_rejects_readers_returning_a_different_chat_or_project():
    chat_id, project_id = uuid.uuid4(), uuid.uuid4()
    with pytest.raises(BadDataException, match="different chat"):
        await resolve(chat_id, ChatScopeSnapshot(uuid.uuid4(), None, (), ()))
    with pytest.raises(BadDataException, match="different project"):
        await resolve(
            chat_id,
            ChatScopeSnapshot(chat_id, project_id, (), ()),
            ProjectScopeSnapshot(uuid.uuid4(), 1, frozenset(), ()),
        )


def test_delegation_to_ineligible_agent_is_rejected():
    scope, _, child_model = make_scope()
    with pytest.raises(BadDataException, match="not eligible"):
        scope.narrow_for_sub_agent(
            agent_id=uuid.uuid4(),
            executed_model=child_model,
            configuration_revision=1,
            effective_internal_tools=frozenset(),
        )


@pytest.mark.asyncio
async def test_project_deletion_retires_only_runs_of_its_chats(monkeypatch):
    from asterism.domains.chat import membership

    retired = []
    mine = uuid.uuid4()

    async def retire(chat_id):
        retired.append(chat_id)

    async def scalars(_statement):
        return [mine]

    monkeypatch.setattr(membership.chat_jobs, "retire", retire)
    await membership.retire_project_chat_runs(
        user_id="user", project_id=uuid.uuid4(), session=SimpleNamespace(scalars=scalars)
    )

    assert retired == [mine]
