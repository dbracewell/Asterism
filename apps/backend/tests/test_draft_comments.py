"""US-57.2: inline comments parsed from Draft feedback replies, anchored to the draft."""

import uuid
from types import SimpleNamespace

import pytest
from asterism.domains.chat.draft_comment_schemas import DraftDocument
from asterism.domains.chat.draft_comments import anchor_quote, build_comments
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.files.models import FileContentStatus, UserFileModel
from asterism.domains.learning.catalog import require_mode
from asterism.domains.learning.rubric_replies import quoted_notes
from sqlalchemy import update
from test_chat_file_scope import seed_agent
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api

ESSAY = (
    "School uniforms should be required.  Many people think uniforms are boring.\n"
    "But uniforms make everyone equal because nobody can show off expensive clothes. "
    "Also, a study said that schools with uniforms have less bullying."
)

REPLY = """### Thesis
Estimated level: Developing

> School uniforms should be required.

The claim is clear but broad.

> "many people think uniforms are boring"
Good to name the other side; answer it later.

Next step: Narrow the claim to one kind of school.

### Evidence
**Estimated level:** Beginning

> a study said that schools with uniforms have less bullying

Which study? Name it.

> Uniforms cure every problem.

This is not in the draft.

### Organization
Estimated level: Proficient

There is no conclusion yet.

Next step: Add a closing paragraph.

### Style and conventions
Estimated level: Proficient

> nobody can show off **expensive** clothes…

Clear wording.

### Overall
Find a source first."""

RUBRIC = SimpleNamespace(
    levels=("Exemplary", "Proficient", "Developing", "Beginning"),
    criteria=("Thesis", "Evidence", "Analysis", "Organization", "Style and conventions"),
)


def test_mode_asks_for_a_note_after_each_quote():
    mode = require_mode("draft_feedback")
    assert mode.version == 2
    assert "put its note directly below" in mode.instructions
    assert "Next step: one concrete thing" in mode.instructions


def test_quoted_notes_pair_each_quote_with_the_text_below_it():
    pairs = quoted_notes("> first\n> line\nNote one\ncontinues.\n\n> 'second'\n\nNote two.\nNext step: later\n")
    assert [(pair.quote, pair.note) for pair in pairs] == [
        ("first line", "Note one continues."),
        ("second", "Note two."),
    ]
    assert quoted_notes("No quotes here.\nNext step: x") == ()
    # Text after the next step never joins a note.
    tail = quoted_notes("> one\nNote.\nNext step: fix it.\nExtra text.")
    assert [(pair.quote, pair.note) for pair in tail] == [("one", "Note.")]


def test_build_comments_only_for_rubric_runs():
    comments = build_comments(REPLY, SimpleNamespace(rubric=RUBRIC))  # type: ignore[arg-type]
    assert comments is not None
    assert [(c.id, c.criterion, c.level, c.quote) for c in comments.comments] == [
        ("c1", "Thesis", "Developing", "School uniforms should be required."),
        ("c2", "Thesis", "Developing", "many people think uniforms are boring"),
        ("c3", "Evidence", "Beginning", "a study said that schools with uniforms have less bullying"),
        ("c4", "Evidence", "Beginning", "Uniforms cure every problem."),
        ("c5", "Style and conventions", "Proficient", "nobody can show off **expensive** clothes…"),
    ]
    assert comments.comments[1].note == "Good to name the other side; answer it later."
    assert build_comments(REPLY, SimpleNamespace(rubric=None)) is None  # type: ignore[arg-type]
    assert build_comments(REPLY, None) is None
    assert build_comments("Please choose a rubric.", SimpleNamespace(rubric=RUBRIC)) is None  # type: ignore[arg-type]
    no_quotes = "### Thesis\nEstimated level: Developing\nVague.\n\n### Overall\nOk."
    assert build_comments(no_quotes, SimpleNamespace(rubric=RUBRIC)) is None  # type: ignore[arg-type]


def doc(text, id="message", available=True):
    return DraftDocument(id=id, kind="message", name=id, available=available, text=text)


@pytest.mark.parametrize(
    ("quote", "expected"),
    [
        ("School uniforms should be required.", "School uniforms should be required."),
        ("many people think   UNIFORMS are boring", "Many people think uniforms are boring"),
        ("“uniforms make everyone equal”", "uniforms make everyone equal"),
        ("nobody can show off **expensive** clothes…", "nobody can show off expensive clothes"),
        ("Also, a study said ... schools with uniforms have less bullying", "schools with uniforms have less bullying"),
        ("required. Many people", "required.  Many people"),
    ],
)
def test_anchor_tolerates_formatting_differences(quote, expected):
    anchor = anchor_quote(quote, [doc(ESSAY)])
    assert anchor is not None and anchor.document_id == "message"
    assert ESSAY[anchor.start : anchor.end] == expected


def test_anchor_misses_skips_unavailable_documents_and_uses_utf16_offsets():
    assert anchor_quote("Uniforms cure every problem.", [doc(ESSAY)]) is None
    assert anchor_quote("ab", [doc("ab ab")]) is None
    hidden = anchor_quote("uniforms are boring", [doc(ESSAY, "gone", available=False), doc(ESSAY, "file")])
    assert hidden is not None and hidden.document_id == "file"
    emoji = "I love 🐶 dogs. Dogs are loyal."
    anchor = anchor_quote("Dogs are loyal.", [doc(emoji)])
    assert anchor is not None
    # The emoji is one code point in Python but two UTF-16 units in the browser.
    assert (anchor.start, anchor.end) == (16, 31)
    assert emoji.encode("utf-16-le")[anchor.start * 2 : anchor.end * 2].decode("utf-16-le") == "Dogs are loyal."


async def upload(client, name, text):
    response = await client.post("/files/", headers=auth(), files={"files": (name, text.encode(), "text/plain")})
    assert response.status_code == 201, response.text
    return response.json()["files"][0]


async def feedback_run(p, files=(), prompt="Here is my draft for feedback."):
    await seed_agent(p.sessions)
    response = await p.client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": prompt,
            "files": list(files),
            "learning_mode": "draft_feedback",
            "rubric": {"source": "bundled", "id": "argumentative-essay"},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    chat_id, request_id = uuid.UUID(body["info"]["id"]), uuid.UUID(body["messages"][0]["id"])
    async with p.sessions() as session:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=request_id, session=session)
        await session.commit()
    return chat_id, request_id, execution


async def save(p, chat_id, parent_id, execution, content):
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
                model_id=execution.model.id,
            ),
            session,
        )


def review(chat_id, message_id, suffix=""):
    return f"/chat/{chat_id}/messages/{message_id}/draft-review{suffix}"


@pytest.mark.asyncio
async def test_review_anchors_comments_in_the_attached_draft_and_tracks_resolution(produced):
    p = produced
    essay = await upload(p.client, "essay.txt", ESSAY)
    async with p.sessions() as session:
        # The processor normally fills the cache on first read.
        await session.execute(
            update(UserFileModel)
            .where(UserFileModel.id == uuid.UUID(essay["id"]))
            .values(content_status=FileContentStatus.READY, content_cache=ESSAY)
        )
        await session.commit()
    chat_id, request_id, execution = await feedback_run(p, [essay["id"]])
    reply = await save(p, chat_id, request_id, execution, REPLY)
    assert reply.draft_comment_summary is not None
    assert reply.draft_comment_summary.model_dump() == {"total": 5, "resolved": 0}

    response = await p.client.get(review(chat_id, reply.id), headers=auth())
    assert response.status_code == 200, response.text
    body = response.json()
    assert [(d["id"], d["kind"], d["available"]) for d in body["documents"]] == [
        ("message", "message", True),
        (essay["id"], "file", True),
    ]
    anchors = {comment["id"]: comment["anchor"] for comment in body["comments"]}
    assert anchors["c1"]["document_id"] == essay["id"]
    assert ESSAY[anchors["c1"]["start"] : anchors["c1"]["end"]] == "School uniforms should be required."
    assert anchors["c4"] is None  # Not in the draft: listed separately by the UI.
    assert all(comment["resolved"] is False for comment in body["comments"])

    put = await p.client.put(review(chat_id, reply.id, "/comments/c2"), headers=auth(), json={"resolved": True})
    assert put.status_code == 200 and put.json() == {"total": 5, "resolved": 1}
    again = await p.client.put(review(chat_id, reply.id, "/comments/c2"), headers=auth(), json={"resolved": True})
    assert again.json() == {"total": 5, "resolved": 1}
    history = (await p.client.get(f"/chat/{chat_id}", headers=auth())).json()["messages"]
    assert history[-1]["draft_comment_summary"] == {"total": 5, "resolved": 1}
    resolved = (await p.client.get(review(chat_id, reply.id), headers=auth())).json()["comments"]
    assert [comment["resolved"] for comment in resolved] == [False, True, False, False, False]
    reopened = await p.client.put(review(chat_id, reply.id, "/comments/c2"), headers=auth(), json={"resolved": False})
    assert reopened.json()["resolved"] == 0

    # Detaching the file from the chat's scope hides its text.
    async with p.sessions() as session:
        await session.execute(
            update(UserFileModel)
            .where(UserFileModel.id == uuid.UUID(essay["id"]))
            .values(content_cache=None, content_status=FileContentStatus.FAILED)
        )
        await session.commit()
    body = (await p.client.get(review(chat_id, reply.id), headers=auth())).json()
    assert body["documents"][1]["available"] is False and body["documents"][1]["text"] is None
    assert all(comment["anchor"] is None for comment in body["comments"])


@pytest.mark.asyncio
async def test_review_is_owner_only_and_needs_comments(produced):
    p = produced
    chat_id, request_id, execution = await feedback_run(p, prompt=f"My draft:\n\n{ESSAY}")
    reply = await save(p, chat_id, request_id, execution, REPLY)
    body = (await p.client.get(review(chat_id, reply.id), headers=auth())).json()
    assert [d["id"] for d in body["documents"]] == ["message"]
    assert body["comments"][0]["anchor"]["document_id"] == "message"
    assert (await p.client.get(review(chat_id, reply.id), headers=auth("b"))).status_code == 404
    put = await p.client.put(review(chat_id, reply.id, "/comments/c1"), headers=auth("b"), json={"resolved": True})
    assert put.status_code == 404
    missing = await p.client.put(review(chat_id, reply.id, "/comments/c99"), headers=auth(), json={"resolved": True})
    assert missing.status_code == 404
    bad = await p.client.put(review(chat_id, reply.id, "/comments/x1"), headers=auth(), json={"resolved": True})
    assert bad.status_code == 422
    assert (await p.client.get(review(chat_id, request_id), headers=auth())).status_code == 400
    plain = await save(p, chat_id, reply.id, execution, "Example rewrite: Uniforms reduce visible inequality.")
    assert plain.draft_comment_summary is None
