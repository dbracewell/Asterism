"""US-56.3: save-time resolution of asterism-file: references and live availability."""

import uuid
from types import SimpleNamespace

import asterism.db.database as database
import pytest
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.forks import write_fork_step
from asterism.domains.chat.inline_files import MAX_INLINE_FILES, parse_file_references
from asterism.domains.chat.runs import read_run
from asterism.domains.chat.schemas import DelegationRecord, MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.files.produced import register_produced_file
from test_chat_file_scope import chat, seed_agent, upload
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api
BARE = {
    "available": False,
    "role": None,
    "producing_execution_id": None,
    "name": None,
    "mime_type": None,
    "kind": None,
    "size": None,
}


def token(file_id) -> str:
    return f"asterism-file:{file_id}"


def test_parsing_is_distinct_ordered_and_lowercase_only():
    a, b = uuid.uuid4(), uuid.uuid4()
    text = (
        f"![x]({token(a)}) [y]({token(b)}) again {token(a)} `{token(b)}` "
        f"{token(a).upper()} asterism-file://{a} https://x/{token(b)}"
    )
    assert parse_file_references(text) == [a, b]
    assert parse_file_references("asterism-file:not-a-uuid") == []
    assert parse_file_references(f"ASTERISM-FILE:{a}") == []


async def accepted_run(p, files=()):
    agent = await seed_agent(p.sessions)
    record = await chat(p.client, agent, files)
    chat_id, request_id = uuid.UUID(record["info"]["id"]), uuid.UUID(record["messages"][0]["id"])
    async with p.sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=request_id, session=session)
        await session.commit()
    scope = SimpleNamespace(user_id="a", chat_id=chat_id, execution_id=execution.id, agent_id=uuid.UUID(agent))
    return chat_id, request_id, execution, scope


async def save_step(p, chat_id, parent_id, execution, content, delegations=None):
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
                delegations=delegations,
                model_id=execution.model.id if execution else uuid.uuid4(),
            ),
            session,
        )


def delegation(execution_id, sub_agent_id, output) -> DelegationRecord:
    return DelegationRecord(
        execution_id=uuid.uuid4(),
        parent_execution_id=execution_id,
        sub_agent_id=sub_agent_id,
        name="Helper",
        depth=0,
        status="completed",
        started_at_ms=0,
        ended_at_ms=1,
        output=output,
    )


@pytest.mark.asyncio
async def test_only_scoped_and_run_produced_files_resolve(produced):
    p = produced
    attached = await upload(p.client, "attached.txt")
    library = await upload(p.client, "library.txt")
    foreign = await upload(p.client, "foreign.txt", "b")
    chat_id, request_id, execution, scope = await accepted_run(p, [attached["id"]])
    made = await register_produced_file(scope, tool="t", name="made.png", content=b"plain text")
    _, other_request, other_execution, other_scope = await accepted_run(p)
    elsewhere = await register_produced_file(other_scope, tool="t", name="elsewhere.txt", content=b"x")
    missing = uuid.uuid4()

    ids = [attached["id"], made.file_id, library["id"], foreign["id"], missing, elsewhere.file_id]
    step = await save_step(p, chat_id, request_id, execution, " ".join(f"![f]({token(i)})" for i in ids))
    refs = [ref.model_dump(mode="json") for ref in step.inline_files]
    assert [ref["file_id"] for ref in refs] == [str(i) for i in ids]
    assert refs[0] == {
        "file_id": attached["id"],
        "available": True,
        "role": "referenced",
        "producing_execution_id": None,
        "name": "attached.txt",
        "mime_type": "text/plain",
        "kind": "text",
        "size": len(b"attached.txt"),
    }
    assert refs[1]["role"] == "produced" and refs[1]["available"] is True
    assert refs[1]["producing_execution_id"] == str(execution.id)
    assert refs[1]["name"] == "made.txt"
    # Library-only, foreign, missing and other-run files are indistinguishable.
    for ref in refs[2:]:
        assert {key: value for key, value in ref.items() if key != "file_id"} == BARE

    # The chat API returns the same resolved list.
    response = await p.client.get(f"/chat/{chat_id}", headers=auth())
    assert response.status_code == 200, response.text
    saved = next(m for m in response.json()["messages"] if m["id"] == str(step.id))
    assert saved["inline_files"] == refs
    assert other_request != request_id and other_execution.id != execution.id


@pytest.mark.asyncio
async def test_without_a_run_nothing_resolves_and_the_limit_applies(produced):
    p = produced
    attached = await upload(p.client, "attached.txt")
    chat_id, request_id, execution, _ = await accepted_run(p, [attached["id"]])
    step = await save_step(p, chat_id, request_id, None, f"![a]({token(attached['id'])})")
    assert [ref.available for ref in step.inline_files] == [False]

    fillers = [uuid.uuid4() for _ in range(MAX_INLINE_FILES)]
    text = " ".join(token(i) for i in [*fillers, attached["id"]])
    step = await save_step(p, chat_id, step.id, execution, text)
    assert len(step.inline_files) == MAX_INLINE_FILES + 1
    assert not any(ref.available for ref in step.inline_files)
    step = await save_step(p, chat_id, step.id, execution, token(attached["id"]))
    assert step.inline_files[0].available is True


@pytest.mark.asyncio
async def test_sub_agent_output_resolves_only_its_own_produced_files(produced):
    p = produced
    attached = await upload(p.client, "attached.txt")
    chat_id, request_id, execution, scope = await accepted_run(p, [attached["id"]])
    helper = uuid.uuid4()
    child = SimpleNamespace(**{**vars(scope), "agent_id": helper})
    parent_file = await register_produced_file(scope, tool="t", name="parent.txt", content=b"p")
    child_file = await register_produced_file(child, tool="t", name="child.txt", content=b"c")
    output = " ".join(token(i) for i in (attached["id"], parent_file.file_id, child_file.file_id))
    step = await save_step(
        p, chat_id, request_id, execution, f"{token(child_file.file_id)}", [delegation(execution.id, helper, output)]
    )
    assert [(r.available, r.role) for r in step.inline_files] == [(True, "produced")]
    record = (step.delegations or [])[0]
    assert [(r.available, r.role) for r in record.inline_files] == [
        (True, "referenced"),
        (False, None),
        (True, "produced"),
    ]


@pytest.mark.asyncio
async def test_deleted_files_turn_unavailable_and_share_the_missing_404(produced, monkeypatch):
    p = produced
    kept = await upload(p.client, "kept.txt")
    gone = await upload(p.client, "gone.txt")
    foreign = await upload(p.client, "foreign.txt", "b")
    chat_id, request_id, execution, _ = await accepted_run(p, [kept["id"], gone["id"]])
    step = await save_step(p, chat_id, request_id, execution, f"{token(kept['id'])} {token(gone['id'])}")
    assert [ref.available for ref in step.inline_files] == [True, True]

    assert (await p.client.delete(f"/files/{gone['filename']}", headers=auth())).status_code in (200, 204)
    body = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()
    saved = next(m for m in body["messages"] if m["id"] == str(step.id))["inline_files"]
    assert [ref["available"] for ref in saved] == [True, False]
    assert saved[1]["name"] == "gone.txt"  # Saved hints stay; bytes do not.
    async with p.sessions() as session:
        run = await read_run(user_id="a", chat_id=chat_id, message_id=step.id, session=session)
    assert [ref.available for ref in run.steps[0].inline_files] == [True, False]

    responses = [
        await p.client.get(f"/chat/{chat_id}/files/{file_id}{suffix}", headers=auth())
        for file_id in (gone["id"], foreign["id"], uuid.uuid4())
        for suffix in ("", "/info")
    ]
    assert {(r.status_code, r.content) for r in responses[0::2]} == {(responses[0].status_code, responses[0].content)}
    assert {(r.status_code, r.content) for r in responses[1::2]} == {(responses[1].status_code, responses[1].content)}
    assert responses[0].status_code == responses[1].status_code == 404

    # A fork step re-resolves against live access when it is written.
    monkeypatch.setattr("asterism.domains.chat.forks.get_async_db_session", database.get_async_db_session)
    rewritten = await write_fork_step(
        user_id="a",
        chat_id=chat_id,
        message_id=step.id,
        status=MessageStatus.COMPLETED,
        tool_call_results=None,
        delegations=None,
        context=None,
    )
    assert rewritten.inline_files[1].model_dump(mode="json", exclude={"file_id"}) == BARE
