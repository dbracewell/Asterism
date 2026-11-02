"""US-55.1: save-time resolution of asterism-cite: claim citations and live availability."""

import uuid

import asterism.db.database as database
import pytest
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.forks import write_fork_step
from asterism.domains.chat.prompt_composition import CITATION_GUIDANCE, build_runtime_prompt
from asterism.domains.chat.runs import read_run
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.chat.span_citations import MAX_SPAN_CITATIONS, parse_citation_keys
from asterism.domains.llm.schemas import Function, ToolCall, ToolResult
from asterism.domains.retrieval.citations import citation_key, citation_token
from test_chat_file_scope import upload
from test_inline_file_resolution import accepted_run, delegation
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api


def search(*hits: tuple[str, str, str]) -> ToolResult:
    """A recorded search_knowledge result with (file_id, chunk_id, excerpt) hits."""
    return ToolResult(
        content="",
        raw_result={
            "results": [
                {
                    "file_id": file_id,
                    "sources": ["chat"],
                    "message_ids": [],
                    "artifact_generation": 1,
                    "chunk_id": chunk_id,
                    "score": 0.9,
                    "match_kind": "text",
                    "excerpt": excerpt,
                    "citation": citation_token(uuid.UUID(file_id), chunk_id),
                }
                for file_id, chunk_id, excerpt in hits
            ]
        },
        is_empty=False,
        tool_call=ToolCall(id=str(uuid.uuid4()), function=Function(name="search_knowledge", arguments="{}")),
    )


def key(file_id: str, chunk_id: str) -> str:
    return citation_key(uuid.UUID(file_id), chunk_id)


async def save(p, chat_id, parent_id, execution, content, results=None, delegations=None):
    async with p.sessions() as session:
        return await add_message(
            "a",
            chat_id,
            NewMessageRequest(
                role="assistant",
                content=content,
                status=MessageStatus.COMPLETED,
                parent_message_id=parent_id,
                execution=execution,
                tool_call_results=results,
                delegations=delegations,
                model_id=execution.model.id if execution else uuid.uuid4(),
            ),
            session,
        )


def test_parsing_is_distinct_ordered_and_exact():
    a, b, c = "0123456789ab", "abcdef012345", "fedcba987654"
    text = (
        f"[x](asterism-cite:{a}) [y](asterism-cite:{b},{a}) `asterism-cite:{c}` "
        f"asterism-cite:{a.upper()} asterism-cite:{a}0 asterism-cite:{a},{b},{c},{a},{b}"
    )
    # Code spans are a safe superset; over-long keys and five-key lists are not tokens.
    assert parse_citation_keys(text) == [a, b, c]
    assert parse_citation_keys("asterism-cite:short") == []


@pytest.mark.asyncio
async def test_citations_resolve_only_to_chunks_retrieved_in_the_run(produced):
    p = produced
    attached = await upload(p.client, "notes.txt")
    library = await upload(p.client, "library.txt")
    chat_id, request_id, execution, _ = await accepted_run(p, [attached["id"]])
    in_scope = (attached["id"], "c1", "  The sky\n is blue.  ")
    out_of_scope = (library["id"], "c2", "Outside the ceiling.")

    # Retrieval happens on one step; the answer cites it on the next.
    first = await save(p, chat_id, request_id, execution, "Searching.", [search(in_scope, out_of_scope)])
    unretrieved = key(attached["id"], "never-retrieved")
    answer = (
        f"[The sky is blue.](asterism-cite:{key(*in_scope[:2])}) "
        f"[Leak](asterism-cite:{key(*out_of_scope[:2])},{unretrieved})"
    )
    step = await save(p, chat_id, first.id, execution, answer)
    cited = [c.model_dump(mode="json") for c in step.citations]
    assert cited[0] == {
        "key": key(*in_scope[:2]),
        "available": True,
        "file_id": attached["id"],
        "chunk_id": "c1",
        "artifact_generation": 1,
        "match_kind": "text",
        "name": "notes.txt",
        "excerpt": "The sky is blue.",
    }
    # Out-of-ceiling and never-retrieved keys are indistinguishable bare entries.
    for entry in cited[1:]:
        assert set(k for k, v in entry.items() if v is not None) == {"key", "available"}
        assert entry["available"] is False

    # A later run of the same chat cannot cite this run's retrievals.
    async with p.sessions() as session:
        follow_up = await add_message(
            "a",
            chat_id,
            NewMessageRequest(role="user", content="And?", parent_message_id=step.id, model_id=execution.model.id),
            session,
        )
        later_execution = await prepare_execution(
            user_id="a", chat_id=chat_id, message_id=follow_up.id, session=session
        )
        await session.commit()
    later = await save(p, chat_id, follow_up.id, later_execution, answer)
    assert not any(c.available for c in later.citations)

    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))
    assert saved["citations"] == cited


@pytest.mark.asyncio
async def test_without_a_run_nothing_resolves_and_the_limit_applies(produced):
    p = produced
    attached = await upload(p.client, "notes.txt")
    chat_id, request_id, execution, _ = await accepted_run(p, [attached["id"]])
    hit = (attached["id"], "c1", "text")
    step = await save(p, chat_id, request_id, None, f"[a](asterism-cite:{key(*hit[:2])})", [search(hit)])
    assert [c.available for c in step.citations] == [False]

    fillers = " ".join(f"asterism-cite:{i:012x}" for i in range(MAX_SPAN_CITATIONS))
    step = await save(p, chat_id, step.id, execution, f"{fillers} asterism-cite:{key(*hit[:2])}", [search(hit)])
    assert len(step.citations) == MAX_SPAN_CITATIONS + 1
    assert not any(c.available for c in step.citations)


@pytest.mark.asyncio
async def test_sub_agents_cite_only_their_own_retrievals_and_the_main_agent_cites_theirs(produced):
    p = produced
    a = await upload(p.client, "a.txt")
    b = await upload(p.client, "b.txt")
    chat_id, request_id, execution, _ = await accepted_run(p, [a["id"], b["id"]])
    mine, theirs = (a["id"], "main", "Main."), (b["id"], "child", "Child.")
    child = delegation(execution.id, uuid.uuid4(), f"asterism-cite:{key(*mine[:2])} asterism-cite:{key(*theirs[:2])}")
    child.tool_results = [search(theirs)]
    sibling = delegation(execution.id, uuid.uuid4(), f"asterism-cite:{key(*theirs[:2])}")
    step = await save(
        p,
        chat_id,
        request_id,
        execution,
        f"asterism-cite:{key(*mine[:2])},{key(*theirs[:2])}",
        [search(mine)],
        [child, sibling],
    )
    assert [c.available for c in step.citations] == [True, True]
    records = step.delegations or []
    assert [c.available for c in records[0].citations] == [False, True]
    assert [c.available for c in records[1].citations] == [False]


@pytest.mark.asyncio
async def test_removed_files_turn_unavailable_on_read_and_forks_re_resolve(produced, monkeypatch):
    p = produced
    kept = await upload(p.client, "kept.txt")
    gone = await upload(p.client, "gone.txt")
    chat_id, request_id, execution, _ = await accepted_run(p, [kept["id"], gone["id"]])
    hits = [(kept["id"], "k", "Kept."), (gone["id"], "g", "Gone.")]
    text = " ".join(f"[claim](asterism-cite:{key(*hit[:2])})" for hit in hits)
    step = await save(p, chat_id, request_id, execution, text, [search(*hits)])
    assert [c.available for c in step.citations] == [True, True]

    assert (await p.client.delete(f"/files/{gone['filename']}", headers=auth())).status_code in (200, 204)
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))["citations"]
    assert [c["available"] for c in saved] == [True, False]
    assert saved[1]["name"] == "gone.txt"  # The snapshot stays; the file does not.
    async with p.sessions() as session:
        run = await read_run(user_id="a", chat_id=chat_id, message_id=step.id, session=session)
    assert [c.available for c in run.steps[0].citations] == [True, False]

    monkeypatch.setattr("asterism.domains.chat.forks.get_async_db_session", database.get_async_db_session)
    rewritten = await write_fork_step(
        user_id="a",
        chat_id=chat_id,
        message_id=step.id,
        status=MessageStatus.COMPLETED,
        tool_call_results=[search(*hits)],
        delegations=None,
        context=None,
    )
    assert [c.available for c in rewritten.citations] == [True, False]
    assert rewritten.citations[1].name is None


@pytest.mark.asyncio
@pytest.mark.parametrize(("tools", "expected"), [([], False), (["search_knowledge"], True)])
async def test_guidance_only_when_the_run_can_search(tools, expected):
    from types import SimpleNamespace

    prompt = await build_runtime_prompt(
        user_id="a", chat_id=uuid.uuid4(), profile=SimpleNamespace(id=uuid.uuid4()), tools=tools, scope=None
    )
    assert (CITATION_GUIDANCE in prompt) is expected
    assert "[the claim](asterism-cite:<key>)" in CITATION_GUIDANCE
    assert "http" not in CITATION_GUIDANCE
