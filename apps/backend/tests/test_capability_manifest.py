"""US-54.2: capability manifests recorded at execution time, with grant reasons."""

import uuid

import pytest
from asterism.domains.agent.capabilities import (
    CapabilityApproval,
    CapabilityEntry,
    CapabilityGrant,
    CapabilityKind,
    CapabilityManifest,
)
from asterism.domains.agent.schemas import (
    AgentEvent,
    AgentEventType,
    AgentProfile,
    MainAgentUpdate,
    SubAgentEventEnvelope,
)
from asterism.domains.agent.service import get_main_agent_profile, update_main_agent
from asterism.domains.chat.capabilities import build_capability_manifest
from asterism.domains.chat.delegations import DelegationCollector
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.service import get_one
from asterism.domains.chat.tool_policy import resolve_effective_tools
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from sqlalchemy import update
from test_chat_models import new_chat
from test_context_tools import add_file
from test_context_tools import context_runtime as _context_runtime
from test_projects_api import project_api as _project_api
from tool_policy_doubles import isolated_tool_policy as _isolated_tool_policy

project_api = _project_api
isolated_tool_policy = _isolated_tool_policy
context_runtime = _context_runtime
A = uuid.UUID(int=1)

TOOL_GRANTS = [CapabilityGrant.AGENT_ASSIGNMENT, CapabilityGrant.ADMIN_POLICY, CapabilityGrant.MODEL_SUPPORT]


def by_kind(manifest: CapabilityManifest, kind: CapabilityKind) -> list[CapabilityEntry]:
    return [entry for entry in manifest.entries if entry.kind == kind]


async def accept_turn(r, **extra):
    chat = await new_chat(r.client, model_id=str(A), **extra)
    chat_id, message_id = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with r.sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=message_id, session=session)
        await session.commit()
    return chat_id, execution


@pytest.mark.asyncio
async def test_project_run_records_effective_capabilities_with_grants(context_runtime):
    import asterism.domains.tools.builtin.web_search  # noqa: F401

    r = context_runtime
    file_id = await add_file(r)
    async with r.sessions() as session:
        await update_main_agent("a", MainAgentUpdate(tools=["web_search"]), session)
        await session.commit()

    chat_id, execution = await accept_turn(r, project_id=r.p["id"])
    manifest = execution.capabilities
    assert manifest is not None
    assert manifest.is_sub_agent is False and manifest.model_supports_tools is True

    # The recorded tools are exactly the set live authorization granted.
    profile = await get_main_agent_profile("a")
    live, _ = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=profile, model_id=A)
    tools = {entry.id: entry for entry in by_kind(manifest, CapabilityKind.TOOL)}
    assert sorted(tools) == live == ["search_knowledge", "sub_agent", "web_search"]
    assert tools["web_search"].grants == TOOL_GRANTS
    # Not on the chat's automatic approval list, so the user is asked first.
    assert tools["web_search"].approval == CapabilityApproval.ASK
    assert tools["sub_agent"].grants == [
        CapabilityGrant.ADMIN_POLICY,
        CapabilityGrant.MODEL_SUPPORT,
        CapabilityGrant.PROJECT_SELECTION,
    ]
    assert tools["sub_agent"].approval == CapabilityApproval.AUTOMATIC
    assert CapabilityGrant.FILE_SCOPE in tools["search_knowledge"].grants

    # Only the project's selected sub-agent, never the other project's.
    sub_agents = by_kind(manifest, CapabilityKind.SUB_AGENT)
    assert [(entry.id, entry.name) for entry in sub_agents] == [(r.a["id"], "Allowed")]
    assert sub_agents[0].grants == [CapabilityGrant.PROJECT_SELECTION]

    files = by_kind(manifest, CapabilityKind.FILE)
    assert [entry.id for entry in files] == [str(file_id)]
    assert files[0].grants == [CapabilityGrant.PROJECT_SELECTION] and files[0].name
    assert by_kind(manifest, CapabilityKind.SKILL) == []

    # Later settings changes do not rewrite the recorded run.
    async with r.sessions() as session:
        await session.execute(
            update(ApplicationSettingsModel).where(ApplicationSettingsModel.key == "active_tools").values(value=[])
        )
        await session.commit()
        stored = await get_one(chat_id, "a", session)
    # Until the assistant answer persists, the recorded run is the pending execution.
    assert stored.info.pending_execution is not None
    assert stored.info.pending_execution.capabilities == manifest


@pytest.mark.asyncio
async def test_general_chat_and_model_without_tool_support(context_runtime):
    import asterism.domains.tools.builtin.web_search  # noqa: F401

    r = context_runtime
    async with r.sessions() as session:
        await update_main_agent("a", MainAgentUpdate(tools=["web_search"]), session)
        await session.commit()

    # General chats never delegate and have no project files.
    _, execution = await accept_turn(r)
    assert execution.capabilities is not None
    assert [entry.id for entry in execution.capabilities.entries] == ["web_search"]

    async with r.sessions() as session:
        await session.execute(update(LLMModel).values(supports_tools=False))
        await session.commit()
    _, execution = await accept_turn(r, project_id=r.p["id"])
    manifest = execution.capabilities
    assert manifest is not None and manifest.model_supports_tools is False
    assert by_kind(manifest, CapabilityKind.TOOL) == []
    assert by_kind(manifest, CapabilityKind.SUB_AGENT) == []


def _profile(**extra) -> AgentProfile:
    return AgentProfile.model_validate(
        {
            "name": "Researcher",
            "description": "",
            "sub_agent": True,
            "model_id": A,
            "system_prompt": None,
            "max_steps": 5,
            "tools": ["web_search"],
            **extra,
        }
    )


@pytest.mark.asyncio
async def test_sub_agent_tools_run_without_asking_and_single_step_agents_get_none(context_runtime):
    r = context_runtime
    async with r.sessions() as session:
        manifest = await build_capability_manifest(
            user_id="a",
            chat_id=r.chat_id,
            profile=_profile(),
            model_supports_tools=True,
            tools=["web_search"],
            auto_approved_tools=None,
            skills=(),
            files=(),
            delegation=None,
            session=session,
        )
        assert manifest.is_sub_agent and manifest.agent_name == "Researcher"
        assert [(entry.id, entry.approval) for entry in manifest.entries] == [
            ("web_search", CapabilityApproval.AUTOMATIC)
        ]
        single = await build_capability_manifest(
            user_id="a",
            chat_id=r.chat_id,
            profile=_profile(max_steps=1),
            model_supports_tools=True,
            tools=["web_search"],
            auto_approved_tools=None,
            skills=(),
            files=(),
            delegation=None,
            session=session,
        )
    assert single.entries == []


def test_delegation_record_keeps_the_manifest_from_the_first_envelope():
    manifest = CapabilityManifest(
        agent_id=uuid.uuid4(), agent_name="Researcher", is_sub_agent=True, configuration_revision=1
    )
    execution_id, sub_agent_id = uuid.uuid4(), uuid.uuid4()

    def envelope(event_type: AgentEventType, capabilities=None) -> SubAgentEventEnvelope:
        return SubAgentEventEnvelope(
            execution_id=execution_id,
            sub_agent_id=sub_agent_id,
            sub_agent_name="Researcher",
            capabilities=capabilities,
            depth=1,
            event=AgentEvent(type=event_type, content="done"),
        )

    collector = DelegationCollector()
    collector.observe(envelope(AgentEventType.START, manifest), now_ms=1)
    collector.observe(envelope(AgentEventType.COMPLETE), now_ms=2)
    [record] = collector.drain()
    assert record.capabilities == manifest


@pytest.mark.asyncio
async def test_sub_agent_sends_its_resolved_manifest_once(isolated_tool_policy):
    from contextlib import nullcontext
    from unittest.mock import AsyncMock, MagicMock, patch

    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.chat.schemas import Chat, ChatInfo
    from asterism.domains.tools.builtin.sub_agent import SubAgentArgs, sub_agent
    from asterism.domains.tools.registry import ToolContext

    child = _profile(id=uuid.uuid4())
    manifest = CapabilityManifest(agent_id=child.id, agent_name=child.name, is_sub_agent=True, configuration_revision=1)
    build = AsyncMock(return_value=manifest)
    envelopes: list[SubAgentEventEnvelope] = []

    async def child_run(self_agent, messages):
        # The real Agent.run resolves its tools before the first event.
        self_agent.effective_tools = ["web_search"]
        yield AgentEvent(type=AgentEventType.START)
        yield AgentEvent(type=AgentEventType.COMPLETE, content="answer")

    ctx = ToolContext(
        args=SubAgentArgs(agent_id=child.id, prompt="Research"),
        user=AuthedUser(id="user-1", email="u@test.local", name="U", role="user"),
        user_message="",
        session=Chat(info=ChatInfo(id=uuid.uuid4(), user_id="user-1", created_at=0, updated_at=0), messages=[]),
        app_settings=MagicMock(),
        client=MagicMock(),
        call_stack=[uuid.uuid4()],
        event_sink=envelopes.append,
    )
    with (
        patch("asterism.domains.chat.delegation.require_delegation_target", new=AsyncMock(return_value=child)),
        patch("asterism.domains.chat.capabilities.build_capability_manifest", new=build),
        # Never open the real database from an isolated test.
        patch("asterism.db.database.get_async_db_session", new=lambda: nullcontext(MagicMock())),
        patch("asterism.domains.agent.service.create_sub_agent_trace", new=AsyncMock()),
        patch.object(Agent, "run", new=child_run),
    ):
        assert await sub_agent(ctx) == "answer"

    assert [envelope.capabilities for envelope in envelopes] == [manifest, None]
    kwargs = build.await_args.kwargs
    assert kwargs["tools"] == ["web_search"]
    assert kwargs["auto_approved_tools"] is None and kwargs["skills"] == ()
    assert kwargs["profile"].id == child.id
