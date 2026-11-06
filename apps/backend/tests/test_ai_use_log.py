"""US-57.4: the AI-use log lists recorded provenance for the owner's selected chats."""

import uuid

import pytest
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.chat.verification_schemas import MessageVerification, VerificationUsage, VerifiedClaim
from asterism.domains.llm.schemas import Function, ToolCall
from sqlalchemy import update
from test_draft_comments import ESSAY, REPLY, feedback_run, upload
from test_exercises import exercise_run, record
from test_produced_files import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

produced = _produced
project_api = _project_api
LOG = "/chat/ai-use-log"


async def save(p, chat_id, parent_id, execution, content, tool_calls=None):
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
                tool_calls=tool_calls,
                model_id=execution.model.id,
            ),
            session,
        )


def call(name):
    return ToolCall(id=str(uuid.uuid4()), function=Function(name=name, arguments="{}"))


@pytest.mark.asyncio
async def test_log_lists_each_turn_with_its_recorded_provenance(produced):
    p = produced
    essay = await upload(p.client, "essay.txt", ESSAY)
    chat_id, request_id, execution = await feedback_run(p, [essay["id"]])
    step = await save(p, chat_id, request_id, execution, "", tool_calls=[call("search_knowledge"), call("web_search")])
    reply = await save(p, chat_id, step.id, execution, REPLY, tool_calls=None)
    verification = MessageVerification(
        model_id=execution.model.id,
        model_name="Checker",
        created_at=5_000,
        file_ids=[],
        claims=[
            VerifiedClaim(claim="a", label="supported"),
            VerifiedClaim(claim="b", label="supported"),
            VerifiedClaim(claim="c", label="contradicted"),
        ],
        usage=VerificationUsage(claims_found=3, claims_checked=3, claim_limit=12),
    )
    async with p.sessions() as session:
        await session.execute(update(MessageModel).where(MessageModel.id == reply.id).values(verification=verification))
        await session.commit()

    response = await p.client.post(LOG, headers=auth(), json={"chat_ids": [str(chat_id)]})
    assert response.status_code == 200, response.text
    log = response.json()
    # Unix seconds, like every other time in the log.
    assert 1_700_000_000 < log["generated_at"] < 10_000_000_000
    [chat] = log["chats"]
    assert chat["chat_id"] == str(chat_id) and chat["project"] is None
    [turn] = chat["turns"]
    assert turn["message_id"] == str(request_id)
    assert turn["prompt"] == "Here is my draft for feedback."
    assert turn["learning_mode"]["id"] == "draft_feedback"
    assert turn["rubric"] == "Argumentative essay"
    assert turn["persona"] == execution.persona.name
    assert turn["files"] == [{"name": "essay.txt", "available": True}]
    assert turn["template"] is None and turn["skills"] == [] and turn["compared"] is False
    assert turn["reply"] == {
        "message_id": str(reply.id),
        "at": reply.created_at,
        "status": "completed",
        "model": execution.model.name,
        "tools": ["search_knowledge", "web_search"],
        "cited_files": [],
        "exercise": False,
        "verification": {
            "model": "Checker",
            "at": 5,
            "supported": 2,
            "unsupported": 0,
            "contradicted": 1,
            "unchecked": 0,
        },
        "draft_comments": {"total": 5, "resolved": 0},
    }
    # Answer text is never part of the log.
    assert "The claim is clear but broad." not in response.text


@pytest.mark.asyncio
async def test_exercise_answers_are_labelled_and_templates_recorded(produced):
    p = produced
    chat_id, request_id, execution = await exercise_run(p)
    answer = await save(p, chat_id, request_id, execution, record())
    sent = await p.client.post(
        f"/chat/{chat_id}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Another one",
            "parent_message_id": str(answer.id),
            "expected_model_revision": 1,
            "template": {"source": "framework", "id": "rtf", "revision": 2, "level": "standard"},
        },
    )
    assert sent.status_code == 200, sent.text
    log = (await p.client.post(LOG, headers=auth(), json={"chat_ids": [str(chat_id)]})).json()
    first, turn = log["chats"][0]["turns"]
    assert first["learning_mode"]["id"] == "spot_the_error"
    assert first["reply"]["exercise"] is True
    assert turn["template"] == {"name": "RTF", "level": "standard", "available": True}


@pytest.mark.asyncio
async def test_log_follows_the_active_branch_and_includes_unanswered_turns(produced):
    p = produced
    chat_id, request_id, execution = await feedback_run(p, prompt="First draft")
    await save(p, chat_id, request_id, execution, "Old answer")
    newer = await save(p, chat_id, request_id, execution, "Regenerated answer")
    sent = await p.client.post(
        f"/chat/{chat_id}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Second draft",
            "parent_message_id": str(newer.id),
            "expected_model_revision": 1,
        },
    )
    assert sent.status_code == 200, sent.text
    log = (await p.client.post(LOG, headers=auth(), json={"chat_ids": [str(chat_id)]})).json()
    turns = log["chats"][0]["turns"]
    assert [turn["prompt"] for turn in turns] == ["First draft", "Second draft"]
    assert turns[0]["reply"]["message_id"] == str(newer.id)
    assert turns[1]["reply"] is None and turns[1]["rubric"] is None


@pytest.mark.asyncio
async def test_log_is_owner_scoped_and_validated(produced):
    p = produced
    chat_id, _, _ = await feedback_run(p)
    assert (await p.client.post(LOG, json={"chat_ids": [str(chat_id)]})).status_code == 401
    foreign = await p.client.post(LOG, headers=auth("b"), json={"chat_ids": [str(chat_id)]})
    assert foreign.status_code == 404
    mixed = await p.client.post(LOG, headers=auth(), json={"chat_ids": [str(chat_id), str(uuid.uuid4())]})
    assert mixed.status_code == 404
    for body in ({"chat_ids": []}, {"chat_ids": [str(chat_id)] * 2}, {"chat_ids": [str(uuid.uuid4())] * 51}):
        assert (await p.client.post(LOG, headers=auth(), json=body)).status_code == 422


@pytest.mark.asyncio
async def test_project_chats_name_their_project(produced):
    p = produced
    project = await p.client.post("/projects/", headers=auth(), json={"name": "History essay"})
    assert project.status_code in (200, 201), project.text
    project_id = project.json()["id"]
    response = await p.client.post(
        "/chat/",
        headers=auth(),
        json={
            "model_id": "00000000-0000-0000-0000-000000000001",
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Plan",
            "project_id": project_id,
        },
    )
    assert response.status_code == 200, response.text
    chat_id = response.json()["info"]["id"]
    log = (await p.client.post(LOG, headers=auth(), json={"chat_ids": [chat_id]})).json()
    assert log["chats"][0]["project"] == "History essay"
