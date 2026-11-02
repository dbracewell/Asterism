"""US-54.5: fork a recorded run from a delegation step (ADR-0038)."""

import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.execution_scope import ExecutionScope, ModelIdentity
from asterism.domains.agent.instruction_overrides import InstructionOverride, ReplayedStep
from asterism.domains.agent.schemas import AgentEvent, AgentEventType, AgentProfile, SubAgentEventEnvelope
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.execution_models import ChatExecutionModel
from asterism.domains.chat.forks import step_index, subtree_ids, top_level_delegation
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import (
    Chat,
    ChatInfo,
    DelegationRecord,
    MessageStatus,
    NewMessageRequest,
)
from asterism.domains.chat.service import add_message, get_one
from asterism.domains.llm.schemas import Function, LLMEvent, LLMEventType, ToolCall, ToolResult
from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent
from asterism.domains.tools.context import ContextToolScope
from asterism.domains.tools.registry import ToolContext
from sqlalchemy import select
from test_chat_models import A, new_chat
from test_chat_models import project_api as _project_api
from test_projects_api import auth

project_api = _project_api

LEAD, NESTED, OTHER = uuid.UUID(int=101), uuid.UUID(int=102), uuid.UUID(int=103)
USER = AuthedUser(id="a", name="A", email="a@example.test", role="user")


def call(call_id: str, name: str = "sub_agent") -> ToolCall:
    return ToolCall(id=call_id, function=Function(name=name, arguments="{}"))


def result(call_id: str, content: str) -> ToolResult:
    return ToolResult(tool_call=call(call_id), content=content, raw_result=None, is_empty=False)


def record(execution_id, sub_agent_id, *, tool_call_id, parent=None, depth=0, output="") -> DelegationRecord:
    return DelegationRecord(
        execution_id=execution_id,
        parent_execution_id=parent,
        tool_call_id=tool_call_id,
        sub_agent_id=sub_agent_id,
        name=f"Agent {execution_id.int}",
        depth=depth,
        status="completed",
        started_at_ms=1,
        ended_at_ms=2,
        output=output,
    )


async def create_sub_agent(client, name: str, instructions: str) -> dict:
    response = await client.post(
        "/agents/sub-agents",
        headers=auth(),
        json={"name": name, "description": name, "model_id": A, "system_prompt": instructions},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def recorded_run(client, sessions):
    """A finished run: step 1 delegates twice (one delegation nests another), step 2 answers."""
    researcher = await create_sub_agent(client, "Researcher", "Research thoroughly")
    writer = await create_sub_agent(client, "Writer", "Write plainly")
    chat = await new_chat(client)
    chat_id, turn = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    researcher_id, writer_id = uuid.UUID(researcher["id"]), uuid.UUID(writer["id"])
    async with sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=turn, session=session)
        step = await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                model_id=execution.model.id,
                role="assistant",
                content="Delegating",
                tool_calls=[call("lead"), call("other")],
                tool_call_results=[result("lead", "Lead findings"), result("other", "Other draft")],
                delegations=[
                    record(LEAD, researcher_id, tool_call_id="lead", output="Lead findings"),
                    record(NESTED, writer_id, tool_call_id="nested", parent=LEAD, depth=1),
                    record(OTHER, writer_id, tool_call_id="other", output="Other draft"),
                ],
                parent_message_id=turn,
                status=MessageStatus.COMPLETED,
                input_tokens=40,
                output_tokens=8,
                execution=execution,
            ),
            session,
        )
        final = await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                model_id=execution.model.id,
                role="assistant",
                content="Synthesis",
                parent_message_id=step.id,
                status=MessageStatus.COMPLETED,
                execution=execution,
            ),
            session,
        )
        await session.commit()
    return chat_id, turn, step, final, researcher, writer


async def fork(client, chat_id, step_id, delegation_id, instructions="Be brief", user="a", request_id=None):
    return await client.post(
        f"/chat/{chat_id}/messages/{step_id}/fork",
        headers=auth(user),
        json={
            "request_id": str(request_id or uuid.uuid4()),
            "delegation_execution_id": str(delegation_id),
            "instructions": instructions,
        },
    )


# ---------------------------------------------------------------------------
# Record traversal
# ---------------------------------------------------------------------------


def test_nested_delegations_rerun_from_their_top_level_call():
    sub = uuid.uuid4()
    records = [
        record(LEAD, sub, tool_call_id="lead"),
        record(NESTED, sub, tool_call_id="nested", parent=LEAD, depth=1),
        record(OTHER, sub, tool_call_id="other"),
    ]
    assert top_level_delegation(records, records[1]).execution_id == LEAD
    assert top_level_delegation(records, records[2]).execution_id == OTHER
    assert subtree_ids(records, records[0]) == {LEAD, NESTED}


# ---------------------------------------------------------------------------
# Acceptance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fork_adds_an_active_sibling_and_leaves_the_original_branch_unchanged(project_api):
    client, sessions, _ = project_api
    chat_id, turn, step, final, researcher, _ = await recorded_run(client, sessions)
    async with sessions() as session:
        before = {
            row.id: (row.content, row.status, row.tool_call_results, row.delegations, row.active_child_id)
            for row in await session.scalars(select(MessageModel).where(MessageModel.chat_id == chat_id))
        }

    response = await fork(client, chat_id, step.id, LEAD)
    assert response.status_code == 200, response.text
    forked = response.json()
    assert forked["parent_message_id"] == str(turn) and forked["status"] == "pending"
    assert forked["content"] == "Delegating" and forked["input_tokens"] == 0
    assert [item["id"] for item in forked["tool_calls"]] == ["lead", "other"]
    # Only the forked call's result is dropped; the other is reused as recorded.
    assert [item["tool_call"]["id"] for item in forked["tool_call_results"]] == ["other"]
    # The forked delegation and everything beneath it run again; the rest is reused.
    assert [(item["execution_id"], item["reused"]) for item in forked["delegations"]] == [(str(OTHER), True)]

    execution = forked["execution"]
    assert execution["fork"]["source_message_id"] == str(step.id)
    assert execution["fork"]["sub_agent_id"] == researcher["id"]
    assert execution["fork"]["step_index"] == 0
    assert execution["request_message_id"] == forked["id"]
    assert execution["context"]["execution_id"] == execution["id"]
    # The instructions stay private; provenance carries a digest.
    assert "Be brief" not in response.text
    assert execution["fork"]["overrides"][0]["base_revision"] == researcher["config_revision"]

    async with sessions() as session:
        rows = {
            row.id: row for row in await session.scalars(select(MessageModel).where(MessageModel.chat_id == chat_id))
        }
        # Every original message is untouched except the parent's active pointer.
        for message_id, (content, status, results, delegations, active) in before.items():
            row = rows[message_id]
            assert (row.content, row.status, row.tool_call_results, row.delegations) == (
                content,
                status,
                results,
                delegations,
            )
            if message_id != turn:
                assert row.active_child_id == active
        assert rows[turn].active_child_id == uuid.UUID(forked["id"])
        assert rows[step.id].parent_message_id == turn and rows[final.id].parent_message_id == step.id
        source = await session.get(ChatExecutionModel, step.execution.id)
        copy = await session.get(ChatExecutionModel, uuid.UUID(execution["id"]))
        assert copy.prompt == source.prompt
        assert copy.execution.configuration == source.execution.configuration
        assert copy.execution.model == source.execution.model
        assert [item.instructions for item in copy.instruction_overrides] == ["Be brief"]

    # The definition is not modified by forking.
    definition = (await client.get("/agents/sub-agents", headers=auth())).json()["items"]
    saved = next(item for item in definition if item["id"] == researcher["id"])
    assert (saved["system_prompt"], saved["config_revision"]) == ("Research thoroughly", researcher["config_revision"])

    # Both branches are reachable: the active branch now ends at the fork.
    body = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    assert [message["id"] for message in body["messages"]][-1] == forked["id"]
    assert body["messages"][-1]["sibling_count"] == 2


@pytest.mark.asyncio
async def test_fork_is_idempotent_owner_only_and_refused_with_pending_work(project_api):
    client, sessions, _ = project_api
    chat_id, _, step, _, _, _ = await recorded_run(client, sessions)
    assert (await fork(client, chat_id, step.id, LEAD, user="b")).status_code == 404
    assert (
        await client.get(
            f"/chat/{chat_id}/messages/{step.id}/fork/instructions",
            params={"delegation_execution_id": str(LEAD)},
            headers=auth("b"),
        )
    ).status_code == 404
    assert (await fork(client, chat_id, step.id, uuid.uuid4())).status_code == 404

    request_id = uuid.uuid4()
    first = await fork(client, chat_id, step.id, LEAD, request_id=request_id)
    again = await fork(client, chat_id, step.id, LEAD, request_id=request_id)
    assert first.status_code == again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert (await fork(client, chat_id, step.id, LEAD, "Changed", request_id=request_id)).status_code == 409

    # The fork is pending, so the chat has work to resume first.
    refused = await fork(client, chat_id, uuid.UUID(first.json()["id"]), OTHER)
    assert refused.status_code == 409
    # The original step is no longer on the active branch.
    assert (await fork(client, chat_id, step.id, OTHER)).status_code == 409


@pytest.mark.asyncio
async def test_fork_instructions_start_from_the_definition_or_the_runs_own_override(project_api):
    client, sessions, _ = project_api
    chat_id, _, step, _, researcher, writer = await recorded_run(client, sessions)
    path = f"/chat/{chat_id}/messages/{step.id}/fork/instructions"
    nested = (await client.get(path, params={"delegation_execution_id": str(NESTED)}, headers=auth())).json()
    assert nested["sub_agent_id"] == writer["id"] and nested["instructions"] == "Write plainly"
    assert nested["source"] == "definition"
    # A nested delegation re-runs its top-level delegation.
    assert nested["rerun_execution_id"] == str(LEAD) and nested["rerun_sub_agent_name"] == "Agent 101"

    forked = (await fork(client, chat_id, step.id, LEAD, "Be brief")).json()
    async with sessions() as session:
        # Pretend the fork ran: its step is complete and keeps a delegation record.
        row = await session.get(MessageModel, uuid.UUID(forked["id"]))
        row.status = MessageStatus.COMPLETED
        row.delegations = [
            *(row.delegations or []),
            record(uuid.UUID(int=104), uuid.UUID(researcher["id"]), tool_call_id="lead"),
        ]
        await session.commit()
    own = (
        await client.get(
            f"/chat/{chat_id}/messages/{forked['id']}/fork/instructions",
            params={"delegation_execution_id": str(uuid.UUID(int=104))},
            headers=auth(),
        )
    ).json()
    assert (own["instructions"], own["source"]) == ("Be brief", "fork")

    # Forking the fork keeps its other overrides and replaces only this sub-agent's.
    second = await fork(client, chat_id, uuid.UUID(forked["id"]), OTHER, "Write formally")
    assert second.status_code == 200, second.text
    fork_info = second.json()["execution"]["fork"]
    assert fork_info["step_index"] == 0
    assert {item["sub_agent_id"] for item in fork_info["overrides"]} == {researcher["id"], writer["id"]}


@pytest.mark.asyncio
async def test_step_index_counts_from_the_runs_request():
    turn = MessageModel(id=uuid.uuid4(), role="user", parent_message_id=None)
    first = MessageModel(id=uuid.uuid4(), role="assistant", parent_message_id=turn.id)
    second = MessageModel(id=uuid.uuid4(), role="assistant", parent_message_id=first.id)
    by_id = {item.id: item for item in (turn, first, second)}
    execution = MagicMock(request_message_id=turn.id, fork=None)
    assert step_index(first, execution, by_id) == 0
    assert step_index(second, execution, by_id) == 1
    # A regeneration started from an assistant step does not count that step.
    assert step_index(second, MagicMock(request_message_id=first.id, fork=None), by_id) == 0
    # A fork's own replayed step keeps its recorded index.
    fork = MagicMock(request_message_id=first.id, fork=MagicMock(step_index=3))
    assert step_index(first, fork, by_id) == 3
    assert step_index(second, fork, by_id) == 4


# ---------------------------------------------------------------------------
# Running a fork
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_running_a_fork_replays_its_step_and_continues_on_the_new_branch(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat_id, turn, step, final, researcher, _ = await recorded_run(client, sessions)
    forked = (await fork(client, chat_id, step.id, NESTED, "Be brief")).json()

    @asynccontextmanager
    async def database(supplied=None):
        if supplied is not None:
            yield supplied
        else:
            async with sessions() as session:
                yield session

    for domain in ["execution", "service", "forks"]:
        monkeypatch.setattr(f"asterism.domains.chat.{domain}.get_async_db_session", database)

    async with sessions() as session:
        opened = await get_one(chat_id, "a", session)
        profile = await get_main_agent_profile("a", session)
    agent = Agent(profile=profile, user=USER, session=opened, model_id=opened.info.selected_model_id)
    seen: dict = {}
    fresh = uuid.UUID(int=201)

    async def generate(*, messages, replay=None):
        seen["history"] = [message.content for message in messages]
        seen["replay"] = replay
        seen["overrides"] = agent.execution_scope.instruction_overrides
        yield AgentEvent(type=AgentEventType.START)
        yield AgentEvent(
            type=AgentEventType.SUB_AGENT,
            sub_agent=SubAgentEventEnvelope(
                execution_id=fresh,
                tool_call_id="lead",
                instructions_overridden=False,
                sub_agent_id=uuid.UUID(researcher["id"]),
                sub_agent_name="Researcher",
                depth=1,
                event=AgentEvent(type=AgentEventType.COMPLETE, content="Brief findings"),
            ),
        )
        yield AgentEvent(
            type=AgentEventType.COMPLETE,
            content=replay.content,
            tool_calls=replay.tool_calls,
            tool_results=[result("lead", "Brief findings"), *replay.reused_results.values()],
        )
        yield AgentEvent(type=AgentEventType.COMPLETE, content="Forked synthesis", input_tokens=9, output_tokens=3)

    monkeypatch.setattr(agent, "run", generate)
    await ChatOrchestrator(agent).run_agent()

    replay: ReplayedStep = seen["replay"]
    assert replay.step_index == 0 and set(replay.reused_results) == {"other"}
    # The fork step is not part of the history it runs on.
    assert seen["history"][-1] == "Hello"
    # Scope carries the fork's private instructions for its sub-agents.
    assert [item.instructions for item in seen["overrides"]] == ["Be brief"]

    body = (await client.get(f"/chat/{chat_id}", headers=auth())).json()
    branch = body["messages"]
    assert [message["content"] for message in branch] == ["Hello", "Delegating", "Forked synthesis"]
    fork_step, answer = branch[1], branch[2]
    assert fork_step["id"] == forked["id"] and fork_step["status"] == "completed"
    assert [item["tool_call"]["id"] for item in fork_step["tool_call_results"]] == ["lead", "other"]
    assert [(item["execution_id"], item["reused"]) for item in fork_step["delegations"]] == [
        (str(OTHER), True),
        (str(fresh), False),
    ]
    assert answer["execution"]["id"] == forked["execution"]["id"]
    assert answer["execution"]["fork"]["sub_agent_id"] == forked["execution"]["fork"]["sub_agent_id"]

    # The original run is unchanged and still its own branch.
    async with sessions() as session:
        original = await session.get(MessageModel, step.id)
        assert original.content == "Delegating" and original.status == MessageStatus.COMPLETED
        assert [item.execution_id for item in original.delegations] == [LEAD, NESTED, OTHER]
        assert original.active_child_id == final.id


@pytest.mark.asyncio
async def test_cancelling_a_fork_step_records_finished_work_and_closes_open_calls(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat_id, _, step, _, _, _ = await recorded_run(client, sessions)
    forked = (await fork(client, chat_id, step.id, LEAD)).json()
    async with sessions() as session:
        opened = await get_one(chat_id, "a", session)
        profile = await get_main_agent_profile("a", session)
    orchestrator = ChatOrchestrator(Agent(profile=profile, user=USER, session=opened, model_id=A))
    pending = opened.messages[-1]
    orchestrator._active_parent_id = pending.id
    orchestrator._fork_step = pending
    written = AsyncMock(return_value=pending)
    with patch("asterism.domains.chat.orchestrator.write_fork_step", new=written):
        await orchestrator.cancel_active_generation()
    kwargs = written.await_args.kwargs
    assert kwargs["message_id"] == uuid.UUID(forked["id"])
    assert kwargs["status"] == MessageStatus.CANCELLED
    # The reused result stays; the call that did not finish is closed as cancelled.
    assert [(item.tool_call.id, item.content) for item in kwargs["tool_call_results"]] == [
        ("lead", "Cancelled before it finished."),
        ("other", "Other draft"),
    ]


# ---------------------------------------------------------------------------
# The agent loop and the sub_agent tool
# ---------------------------------------------------------------------------


class OneAnswer:
    def __init__(self):
        self.calls: list[dict] = []

    async def chat(self, messages, tools=None, **kwargs):
        self.calls.append({"messages": list(messages), "tools": tools})
        yield LLMEvent(type=LLMEventType.COMPLETE, content="Final", finish_reason="stop")


@pytest.mark.asyncio
async def test_agent_replay_runs_only_unreused_calls_then_uses_the_remaining_budget():
    profile = AgentProfile(
        name="Main", description="", sub_agent=False, model_id=None, system_prompt="", max_steps=3, tools=[]
    )
    session = Chat(info=ChatInfo(id=uuid.uuid4(), user_id="a", created_at=0, updated_at=0), messages=[])
    agent = Agent(profile=profile, user=USER, session=session, allowed_tools=[])
    client = OneAnswer()
    ran: list[str] = []

    async def run_tools(*, user_message, auths, event_sink=None):
        for auth_item in auths:
            ran.append(auth_item.tool.id)
            yield result(auth_item.tool.id, "fresh")

    agent._get_client = AsyncMock(return_value=client)
    agent._build_system_prompt = AsyncMock(return_value="")
    agent.resolve_tools = AsyncMock(return_value=["sub_agent"])
    agent._run_tools = run_tools
    agent._approval_policy.authorize = AsyncMock(
        side_effect=lambda calls, allowed: [MagicMock(tool=item, accept=True) for item in calls]
    )
    replay = ReplayedStep(
        content="Delegating",
        thinking="",
        tool_calls=[call("lead"), call("other")],
        reused_results={"other": result("other", "recorded")},
        step_index=1,
    )
    from asterism.domains.llm.schemas import LLMMessage

    events = [event async for event in agent.run([LLMMessage.user("Hello")], replay=replay)]
    assert ran == ["lead"]
    complete = [event for event in events if event.type == AgentEventType.COMPLETE]
    replayed, final = complete
    assert [item.content for item in replayed.tool_results] == ["fresh", "recorded"]
    assert replayed.input_tokens == replayed.output_tokens == 0
    assert final.content == "Final"
    # Step index 1 of 3: only the final step remains, so tools are stripped.
    assert len(client.calls) == 1 and client.calls[0]["tools"] == []
    roles = [message.role for message in client.calls[0]["messages"]]
    assert roles == ["user", "assistant", "tool", "tool"]


def _scope(target: uuid.UUID, overrides=()) -> ExecutionScope:
    return ExecutionScope(
        user_id="a",
        user_profile_id=None,
        agent_id=uuid.uuid4(),
        is_sub_agent=False,
        chat_id=uuid.uuid4(),
        project_id=None,
        selected_model=None,
        executed_model=ModelIdentity(id=uuid.uuid4()),
        eligible_sub_agent_ids=frozenset({target}),
        effective_internal_tools=frozenset({"sub_agent"}),
        active_branch_message_ids=(),
        configuration_revision=1,
        prompt_revision=None,
        allowed_file_ids=frozenset(),
        file_provenance=(),
        instruction_overrides=tuple(overrides),
    )


def test_narrowed_child_scope_inherits_the_forks_instructions():
    target = uuid.uuid4()
    override = InstructionOverride(sub_agent_id=target, base_revision=1, instructions="Be brief")
    child = _scope(target, [override]).narrow_for_sub_agent(
        agent_id=target,
        executed_model=ModelIdentity(id=uuid.uuid4()),
        configuration_revision=1,
        effective_internal_tools=frozenset(),
    )
    assert child.instruction_overrides == (override,)


async def _delegate(target_profile: AgentProfile, overrides) -> tuple[str, list, list[SubAgentEventEnvelope]]:
    session = Chat(info=ChatInfo(id=uuid.uuid4(), user_id="a", created_at=0, updated_at=0), messages=[])
    envelopes: list[SubAgentEventEnvelope] = []
    prompts: list[str | None] = []

    async def child_run(self_agent, messages):
        prompts.append(self_agent.profile.system_prompt)
        yield AgentEvent(type=AgentEventType.COMPLETE, content="Done")

    ctx = ToolContext(
        args=SubAgentArgs(agent_id=target_profile.id, prompt="Work"),
        user=USER,
        user_message="Go",
        session=session,
        app_settings=MagicMock(),
        client=MagicMock(),
        call_stack=[uuid.uuid4()],
        event_sink=envelopes.append,
        execution_scope=_scope(target_profile.id, overrides),
        tool_call_id="lead",
    )
    with (
        patch("asterism.domains.chat.delegation.require_delegation_target", new=AsyncMock(return_value=target_profile)),
        patch(
            "asterism.domains.chat.tool_policy.require_internal_tool",
            new=AsyncMock(
                return_value=ContextToolScope(
                    user_id="a",
                    chat_id=session.info.id,
                    project_id=None,
                    caller_agent_id=uuid.uuid4(),
                    model_id=uuid.uuid4(),
                    file_ids=frozenset(),
                    delegation=None,
                )
            ),
        ),
        patch("asterism.domains.tools.builtin.sub_agent._child_capabilities", new=AsyncMock(return_value=None)),
        patch("asterism.domains.agent.service.create_sub_agent_trace", new=AsyncMock()),
        patch.object(Agent, "run", new=child_run),
    ):
        output = await sub_agent(ctx)
    return output, prompts, envelopes


def _definition(revision: int = 2) -> AgentProfile:
    return AgentProfile(
        id=uuid.uuid4(),
        name="Researcher",
        description="",
        sub_agent=True,
        model_id=uuid.uuid4(),
        system_prompt="Research thoroughly",
        max_steps=3,
        tools=[],
        config_revision=revision,
    )


@pytest.mark.asyncio
async def test_sub_agent_uses_fork_instructions_only_for_the_definition_they_were_written_against():
    definition = _definition()
    override = InstructionOverride(sub_agent_id=definition.id, base_revision=2, instructions="Be brief")
    output, prompts, envelopes = await _delegate(definition, [override])
    assert (output, prompts) == ("Done", ["Be brief"])
    assert {(item.tool_call_id, item.instructions_overridden) for item in envelopes} == {("lead", True)}

    # Without an override the definition's own instructions apply.
    _, prompts, envelopes = await _delegate(definition, [])
    assert prompts == ["Research thoroughly"]
    assert {item.instructions_overridden for item in envelopes} == {False}

    # Saving the definition after forking invalidates the fork's instructions.
    stale = InstructionOverride(sub_agent_id=definition.id, base_revision=1, instructions="Be brief")
    output, prompts, _ = await _delegate(definition, [stale])
    assert prompts == [] and "edited after this fork" in output


@pytest.mark.asyncio
async def test_saving_fork_instructions_is_explicit_and_revision_checked(project_api):
    client, sessions, _ = project_api
    chat_id, _, step, _, researcher, _ = await recorded_run(client, sessions)
    assert (await fork(client, chat_id, step.id, LEAD, "Be brief")).status_code == 200
    path = f"/agents/sub-agents/{researcher['id']}/instructions"
    body = {"system_prompt": "Be brief", "expected_revision": researcher["config_revision"]}
    assert (await client.put(path, headers=auth("b"), json=body)).status_code == 404
    saved = await client.put(path, headers=auth(), json=body)
    assert saved.status_code == 200, saved.text
    definition = saved.json()
    assert definition["system_prompt"] == "Be brief"
    assert definition["config_revision"] == researcher["config_revision"] + 1
    # Only the instructions change.
    assert (definition["name"], definition["model_id"]) == (researcher["name"], researcher["model_id"])
    # A save based on an older read is refused.
    assert (await client.put(path, headers=auth(), json=body)).status_code == 409
