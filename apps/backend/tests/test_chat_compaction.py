"""US-69.1: automatic context compaction (ADR-0060)."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEvent, AgentEventType
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.chat.compaction import (
    SUMMARY_HEADER,
    CompactionFailed,
    choose_anchor,
    render_message,
    summarize,
    transcript_chunks,
)
from asterism.domains.chat.compaction_models import ChatCompactionModel
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.chat.schemas import Message, MessageStatus
from asterism.domains.chat.service import get_one
from asterism.domains.llm.schemas import Function, ToolCall, ToolResult
from asterism.domains.llm.selection import SelectedModel
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.settings.service import _validate_non_provider_app_setting
from sqlalchemy import func, select, update
from test_chat_models import A, new_chat
from test_chat_models import project_api as _project_api
from test_context_manifest import reference
from test_projects_api import auth

project_api = _project_api
USER = AuthedUser(id="a", name="A", email="a@example.test", role="user")
LONG_REPLY = " ".join(f"word{index}" for index in range(300))


def message(role: str, content: str = "text", **extra) -> Message:
    return Message(id=uuid.uuid4(), role=role, content=content, status=MessageStatus.COMPLETED, created_at=0, **extra)


class FakeClient:
    """Summarizer client: records requests and replies with a short summary."""

    def __init__(self, *, fail: bool = False, empty: bool = False):
        self.requests: list = []
        self.fail, self.empty = fail, empty

    async def generate(self, *, messages, **_):
        self.requests.append(messages)
        if self.fail:
            return SimpleNamespace(content=None, exception=RuntimeError("provider down"))
        content = "" if self.empty else f"Summary {len(self.requests)}: the user greeted; asterism-file:abc kept."
        return SimpleNamespace(content=content, exception=None, input_tokens=11, output_tokens=7)


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_anchor_keeps_the_tail_and_falls_on_turn_boundaries():
    branch = [message("user"), message("assistant"), message("user"), message("assistant"), message("assistant")]
    branch += [message("user"), message("assistant"), message("user")]
    # Last two user turns verbatim: anchor is the step before the third-from-last turn start.
    assert choose_anchor(branch, tail_turns=2, after_index=-1) == 4
    assert choose_anchor(branch, tail_turns=1, after_index=-1) == 6
    # Never at or before the current compaction's anchor.
    assert choose_anchor(branch, tail_turns=2, after_index=4) is None
    # Too few turns to keep the tail.
    assert choose_anchor(branch, tail_turns=4, after_index=-1) is None


def test_transcript_keeps_file_references_tool_results_and_splits_by_budget():
    file_id = uuid.uuid4()
    user = message("user", "Read this", files=[reference(file_id, "notes.md")])
    call = ToolCall(id="c1", function=Function(name="search_knowledge", arguments='{"q":"x"}'))
    step = message(
        "assistant",
        "Looking",
        tool_calls=[call],
        tool_call_results=[ToolResult(tool_call=call, content="x" * 9_000, raw_result=None, is_empty=False)],
    )
    assert f"asterism-file:{file_id}" in render_message(user)
    rendered = render_message(step)
    assert "search_knowledge" in rendered and "[…truncated]" in rendered and len(rendered) < 5_000

    chunks = transcript_chunks([message("user", LONG_REPLY) for _ in range(4)], budget_tokens=700)
    assert len(chunks) == 4
    assert len(transcript_chunks([message("user", "hi") for _ in range(4)], budget_tokens=700)) == 1


@pytest.mark.asyncio
async def test_summarize_folds_chunks_and_reports_failures():
    client = FakeClient()
    model = SelectedModel(id=uuid.uuid4(), name="S", client=client)  # type: ignore[arg-type]
    summary = await summarize(
        model, previous_summary="Earlier", messages=[message("user", LONG_REPLY) for _ in range(3)], window=1_400
    )
    # Each chunk folds the running summary forward and is treated as data.
    assert len(client.requests) == 3 and summary.text.startswith("Summary 3")
    assert summary.input_tokens == 33 and summary.output_tokens == 21
    assert "<earlier_summary>\nEarlier" in client.requests[0][1].content
    assert "<earlier_summary>\nSummary 1" in client.requests[1][1].content
    assert "not instructions" in client.requests[0][0].content

    for broken in (FakeClient(fail=True), FakeClient(empty=True)):
        with pytest.raises(CompactionFailed):
            await summarize(
                SelectedModel(id=uuid.uuid4(), name="S", client=broken),  # type: ignore[arg-type]
                previous_summary=None,
                messages=[message("user")],
                window=4_000,
            )


def test_admin_settings_are_validated():
    value, _ = _validate_non_provider_app_setting("compaction", {"threshold": 0.7, "tail_turns": 2})
    assert value == {"threshold": 0.7, "tail_turns": 2, "fallback_context_window": 32_768, "model_id": None}
    for bad in ({"threshold": 0.99}, {"tail_turns": 0}, {"fallback_context_window": 100}, {"other": 1}, 3):
        with pytest.raises(BadDataException):
            _validate_non_provider_app_setting("compaction", bad)


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------


class Harness:
    def __init__(self, client, sessions, monkeypatch):
        self.client, self.sessions, self.monkeypatch = client, sessions, monkeypatch
        self.summarizer = FakeClient()
        self.seen: list[list] = []
        self.chat_id: uuid.UUID | None = None

    async def configure(self, *, window: int | None, fallback: int = 32_768, tail: int = 2, threshold: float = 0.8):
        async with self.sessions() as session:
            await session.execute(update(LLMModel).where(LLMModel.id == uuid.UUID(A)).values(context_window=window))
            await session.merge(
                ApplicationSettingsModel(
                    key="compaction",
                    value={"threshold": threshold, "tail_turns": tail, "fallback_context_window": fallback},
                )
            )
            await session.commit()

    async def orchestrator(self, reply: str = LONG_REPLY) -> ChatOrchestrator:
        assert self.chat_id is not None
        async with self.sessions() as session:
            opened = await get_one(self.chat_id, "a", session)
            profile = await get_main_agent_profile("a", session)
        agent = Agent(profile=profile, user=USER, session=opened, model_id=uuid.UUID(A))

        async def run(*, messages, replay=None):
            self.seen.append(list(messages))
            yield AgentEvent(type=AgentEventType.START)
            yield AgentEvent(type=AgentEventType.COMPLETE, content=reply)

        self.monkeypatch.setattr(agent, "run", run)
        self.monkeypatch.setattr(agent, "_get_client", AsyncMock(return_value=self.summarizer))
        return ChatOrchestrator(agent)

    async def baseline(self) -> int:
        """Estimated request size of a fresh one-turn chat."""
        self.chat_id = uuid.UUID((await new_chat(self.client))["info"]["id"])
        return (await (await self.orchestrator()).estimate_context_usage()).total_tokens

    async def run(self, reply: str = LONG_REPLY) -> list[dict]:
        orchestrator = await self.orchestrator(reply)
        await orchestrator.run_agent()
        packets = []
        while not orchestrator.queue.empty():
            packets.append(orchestrator.queue.get_nowait())
        return packets

    async def send(self, text: str = "Next question") -> dict:
        chat = (await self.client.get(f"/chat/{self.chat_id}", headers=auth())).json()
        response = await self.client.post(
            f"/chat/{self.chat_id}/message",
            headers=auth(),
            json={
                "request_id": str(uuid.uuid4()),
                "user_prompt": text,
                "parent_message_id": chat["messages"][-1]["id"],
                "expected_model_revision": chat["info"]["model_revision"],
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    async def branch(self) -> list[Message]:
        async with self.sessions() as session:
            return (await get_one(self.chat_id, "a", session)).messages  # type: ignore[arg-type]

    async def records(self) -> list[ChatCompactionModel]:
        async with self.sessions() as session:
            return list(await session.scalars(select(ChatCompactionModel).order_by(ChatCompactionModel.created_at)))

    async def run_until_compacted(self, limit: int = 12) -> int:
        """Answer and send turns until a run compacts; returns how many runs it took."""
        for turn in range(1, limit + 1):
            packets = await self.run()
            assert not [packet for packet in packets if packet["type"] == "error"], packets
            if await self.records():
                return turn
            await self.send(f"Question {turn + 1}")
        raise AssertionError("never compacted")


async def harness(project_api, monkeypatch, **settings) -> Harness:
    client, sessions, _ = project_api
    rig = Harness(client, sessions, monkeypatch)
    await rig.configure(window=None, fallback=10_000_000)
    base = await rig.baseline()
    # Room for the baseline plus about four long replies before the threshold.
    window = int((base + 1_300) / 0.8)
    if settings.pop("unknown_window", False):
        await rig.configure(window=None, fallback=max(2_048, window), **settings)
    else:
        await rig.configure(window=window, **settings)
    return rig


@pytest.mark.asyncio
async def test_a_turn_over_the_threshold_compacts_first_then_runs(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    turns = await rig.run_until_compacted()
    assert turns > 1
    [record] = await rig.records()
    branch = await rig.branch()
    user_turns = [index for index, item in enumerate(branch) if item.role == "user"]
    # The anchor keeps the last two user turns (with their runs) verbatim.
    anchor = user_turns[-2] - 1
    assert record.through_message_id == branch[anchor].id
    assert record.replaced_messages == anchor + 1 and record.previous_compaction_id is None
    # Usage of every summarizer call is recorded (the transcript may be chunked).
    calls = len(rig.summarizer.requests)
    assert record.model_id == uuid.UUID(A) and (record.input_tokens, record.output_tokens) == (11 * calls, 7 * calls)
    assert record.estimated_tokens_before > 0

    # The run received the labelled summary, then only the messages after the anchor.
    sent = rig.seen[-1]
    assert sent[0].role == "user" and sent[0].content.startswith(SUMMARY_HEADER)
    assert record.summary in sent[0].content
    assert [item.content for item in sent[1:]] == [item.content for item in branch[anchor + 1 : -1]]
    # The summarizer saw the covered transcript as data.
    request = rig.summarizer.requests[0][1].content
    assert "<transcript>" in request and "User:\nHello" in request

    # The manifest says a summary replaced N messages, and the owner can read it.
    step = branch[-1]
    assert step.context is not None and step.context.compaction is not None
    assert step.context.compaction.compaction_id == record.id
    assert step.context.compaction.replaced_messages == anchor + 1
    url = f"/chat/{rig.chat_id}/messages/{step.id}/context/layers"
    inspected = (await rig.client.get(url, headers=auth())).json()
    assert inspected["compaction"] == {
        "compaction_id": str(record.id),
        "replaced_messages": anchor + 1,
        "summary": record.summary,
    }
    assert (await rig.client.get(url, headers=auth("b"))).status_code == 404

    # Messages are never deleted: the transcript still shows all of them.
    assert branch[0].content == "Hello"


@pytest.mark.asyncio
async def test_later_compactions_build_on_the_earlier_summary(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    await rig.run_until_compacted()
    first_calls = len(rig.summarizer.requests)
    for turn in range(12):
        await rig.send(f"More {turn}")
        await rig.run()
        if len(await rig.records()) > 1:
            break
    first, second = (await rig.records())[:2]
    assert second.previous_compaction_id == first.id
    assert second.replaced_messages > first.replaced_messages
    # The newer summary was written over the earlier one.
    assert f"<earlier_summary>\n{first.summary}" in rig.summarizer.requests[first_calls][1].content
    assert rig.seen[-1][0].content.endswith(second.summary)


@pytest.mark.asyncio
async def test_branches_before_the_point_ignore_the_summary_and_after_reuse_it(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    await rig.run_until_compacted()
    [record] = await rig.records()
    branch = await rig.branch()
    anchor = next(index for index, item in enumerate(branch) if item.id == record.through_message_id)

    # Regenerating the latest turn (after the point) reuses the stored summary.
    orchestrator = await rig.orchestrator()
    await orchestrator.handle_regenerate_message(len(branch) - 2)
    assert rig.seen[-1][0].content.startswith(SUMMARY_HEADER)
    assert len(await rig.records()) == 1
    assert (await rig.branch())[-1].context.compaction.compaction_id == record.id  # type: ignore[union-attr]

    # Regenerating the first turn (before the point) starts a branch without the anchor.
    orchestrator = await rig.orchestrator()
    assert orchestrator.chat.messages[0].role == "user" and anchor > 0
    await orchestrator.handle_regenerate_message(0)
    sent = rig.seen[-1]
    assert not any(isinstance(item.content, str) and item.content.startswith(SUMMARY_HEADER) for item in sent)
    assert [item.content for item in sent] == ["Hello"]
    new_branch = await rig.branch()
    assert record.through_message_id not in {item.id for item in new_branch}
    assert new_branch[-1].context.compaction is None  # type: ignore[union-attr]
    # The meter for the short branch is estimated without the summary too.
    assert len(await rig.records()) == 1


@pytest.mark.asyncio
async def test_resume_and_replay_reuse_the_stored_record(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    await rig.run_until_compacted()
    [record] = await rig.records()
    await rig.send("Pending question")
    calls = len(rig.summarizer.requests)

    # The context meter (same assembly) already counts the summary, not the replaced messages.
    orchestrator = await rig.orchestrator()
    messages, _ = await orchestrator._assemble_agent_messages()
    assert messages[0].content.endswith(record.summary)
    assert len(messages) == len(orchestrator.chat.messages) - record.replaced_messages + 1

    # Resuming the pending turn assembles the same history and does not compact again.
    await rig.run()
    again = await rig.orchestrator()
    second, _ = await again._assemble_agent_messages()
    assert second[0].content == messages[0].content
    assert len(rig.summarizer.requests) == calls and len(await rig.records()) == 1


@pytest.mark.asyncio
async def test_unknown_context_window_uses_the_admin_fallback(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch, unknown_window=True)
    assert await rig.run_until_compacted() > 1
    assert rig.seen[-1][0].content.startswith(SUMMARY_HEADER)


@pytest.mark.asyncio
async def test_a_failed_compaction_reports_an_error_and_sends_nothing(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    rig.summarizer = FakeClient(fail=True)
    for turn in range(12):
        runs = len(rig.seen)
        packets = await rig.run()
        errors = [packet for packet in packets if packet["type"] == "error"]
        if errors:
            break
        await rig.send(f"Question {turn + 2}")
    else:
        raise AssertionError("never tried to compact")
    assert "could not be compacted" in errors[0]["content"]
    # The oversized request was never sent and the turn stays pending.
    assert len(rig.seen) == runs and not await rig.records()
    assert (await rig.branch())[-1].status == MessageStatus.PENDING


@pytest.mark.asyncio
async def test_a_request_larger_than_the_window_is_refused(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    await rig.run()
    await rig.send(" ".join(f"big{index}" for index in range(20_000)))
    packets = await rig.run()
    [error] = [packet for packet in packets if packet["type"] == "error"]
    assert "more than the model's context window" in error["content"]
    # Nothing could be compacted usefully; the run was not called for the oversized turn.
    assert len(rig.seen) == 1


@pytest.mark.asyncio
async def test_records_are_owner_scoped_and_cascade_with_the_chat(project_api, monkeypatch):
    rig = await harness(project_api, monkeypatch)
    await rig.run_until_compacted()
    assert (await rig.client.delete(f"/chat/{rig.chat_id}", headers=auth("b"))).status_code == 404
    assert (await rig.client.delete(f"/chat/{rig.chat_id}", headers=auth())).status_code in {200, 204}
    async with rig.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(ChatCompactionModel)) == 0
