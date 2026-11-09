"""US-71.1: skill drafting runs reuse a hidden chat (ADR-0061)."""

import uuid

import pytest
from asterism.core.exceptions import ForbiddenException
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.prompt_composition import build_prompt_snapshot
from asterism.domains.chat.schemas import Chat, MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message
from asterism.domains.skills.policy import write_policy
from asterism.domains.skills.schemas import SkillPolicy
from asterism.domains.skills.writer import SKILL_WRITER_INSTRUCTIONS, extract_skill_block
from sqlalchemy import update
from test_context_tools import context_runtime, resolve
from test_general_delegation import put
from test_projects_api import auth, create
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
runtime = context_runtime
MODEL = str(uuid.UUID(int=2))

GOOD = """---
name: essay-feedback
description: Gives structured feedback on student essays.
---

# Essay feedback

Read the essay, then comment on thesis, structure and evidence.
"""


def reply(document: str, *, fence: str = "```") -> str:
    return f"Here is the draft.\n\n{fence}skill\n{document.rstrip()}\n{fence}\n"


async def set_policy(r, enabled: bool) -> None:
    async with r.sessions() as db:
        await write_policy(SkillPolicy(enabled=enabled), db)


async def start(r, description="Feedback on essays", **fields):
    return await r.client.post(
        "/skills/drafts",
        headers=auth(),
        json={"request_id": str(uuid.uuid4()), "model_id": MODEL, "description": description, **fields},
    )


async def started(r, **fields) -> Chat:
    response = await start(r, **fields)
    assert response.status_code == 201, response.text
    return Chat.model_validate(response.json())


async def answer(r, chat: Chat, content: str, parent: uuid.UUID) -> uuid.UUID:
    """Completes the pending user turn with an assistant reply, as a run would."""
    async with r.sessions() as db:
        await db.execute(update(MessageModel).where(MessageModel.id == parent).values(status=MessageStatus.COMPLETED))
        await db.commit()
        message = await add_message(
            "a",
            chat.info.id,
            NewMessageRequest(
                model_id=uuid.UUID(MODEL),
                role="assistant",
                content=content,
                parent_message_id=parent,
                status=MessageStatus.COMPLETED,
            ),
            session=db,
        )
        await db.commit()
    return message.id


async def draft(r, chat_id: uuid.UUID, user: str = "a"):
    return await r.client.get(f"/skills/drafts/{chat_id}", headers=auth(user))


async def test_the_last_skill_block_is_the_draft():
    assert extract_skill_block("no block here") is None
    assert extract_skill_block(reply("first") + reply(GOOD)) == GOOD
    assert extract_skill_block(reply(GOOD, fence="~~~")) == GOOD
    # Another language's block is not a draft.
    assert extract_skill_block(f"```markdown\n{GOOD}```") is None
    assert "cannot grant tools" in SKILL_WRITER_INSTRUCTIONS


async def test_drafting_needs_the_skills_policy(runtime):
    r = runtime
    assert (await start(r)).status_code == 403
    await set_policy(r, True)
    chat = await started(r)
    assert chat.info.purpose == "skill_draft" and chat.info.project_id is None
    assert chat.messages[0].content.startswith("Write a skill for this:\n\nFeedback on essays")
    assert (await draft(r, chat.info.id)).json()["status"] == "pending"

    await set_policy(r, False)
    assert (await draft(r, chat.info.id)).status_code == 403
    async with r.sessions() as db:
        with pytest.raises(ForbiddenException):
            await build_prompt_snapshot(
                user_id="a", chat_id=chat.info.id, profile=r.profile, model_id=uuid.UUID(MODEL), session=db
            )


async def test_drafts_are_hidden_from_the_chat_list_but_reachable(runtime):
    r = runtime
    await set_policy(r, True)
    chat = await started(r)
    listed = (await r.client.get("/chat/", headers=auth())).json()["chats"]
    assert chat.info.id not in {uuid.UUID(item["id"]) for item in listed}
    assert (await r.client.get(f"/chat/{chat.info.id}", headers=auth())).status_code == 200
    # Only the owner can read the draft; other chats are not drafts.
    assert (await draft(r, chat.info.id, user="b")).status_code == 404
    assert (await draft(r, r.chat_id)).status_code == 404
    # Nothing is saved as a skill.
    assert (await r.client.get("/skills/", headers=auth())).json()["total"] == 0


async def test_the_writer_gets_a_task_layer_and_no_mode_or_skills(runtime):
    r = runtime
    await set_policy(r, True)
    chat = await started(r)
    async with r.sessions() as db:
        snapshot = await build_prompt_snapshot(
            user_id="a", chat_id=chat.info.id, profile=r.profile, model_id=uuid.UUID(MODEL), session=db
        )
        helper = r.profile.model_copy(update={"sub_agent": True})
        delegated = await build_prompt_snapshot(
            user_id="a", chat_id=chat.info.id, profile=helper, model_id=uuid.UUID(MODEL), session=db
        )
    kinds = [layer.kind for layer in snapshot.layers]
    assert "task" in kinds and "mode" not in kinds and "skills" not in kinds
    assert "[task instructions]\n" + SKILL_WRITER_INSTRUCTIONS in snapshot.text
    # Delegated helpers research; they never get the writing task.
    assert "task" not in [layer.kind for layer in delegated.layers]


async def test_drafts_delegate_only_through_the_general_set(runtime):
    r = runtime
    await set_policy(r, True)
    chat = await started(r)
    names, ceiling = await resolve(r.__class__(**{**vars(r), "chat_id": chat.info.id}))
    assert "sub_agent" not in names and ceiling.delegation.source == "general"
    assert (await put(r.client, [r.a["id"]])).status_code == 200
    names, ceiling = await resolve(r.__class__(**{**vars(r), "chat_id": chat.info.id}))
    assert "sub_agent" in names and ceiling.delegation.agent_ids == frozenset({uuid.UUID(r.a["id"])})
    # A draft can't borrow a project's selections by moving.
    project = await create(r.client, "Drafts")
    moved = await r.client.patch(f"/chat/{chat.info.id}/project", headers=auth(), json={"project_id": project["id"]})
    assert moved.status_code == 409, moved.text


async def test_replies_are_validated_and_revisions_replace_the_draft(runtime):
    r = runtime
    await set_policy(r, True)
    chat = await started(r)
    first = chat.messages[0].id

    no_block = await answer(r, chat, "I need more detail first.", first)
    body = (await draft(r, chat.info.id)).json()
    assert body["status"] == "invalid" and body["message_id"] == str(no_block)
    assert "no ```skill block" in body["error"]

    async def revise(prompt: str, parent: uuid.UUID) -> uuid.UUID:
        sent = await r.client.post(
            f"/chat/{chat.info.id}/message",
            headers=auth(),
            json={
                "request_id": str(uuid.uuid4()),
                "user_prompt": prompt,
                "parent_message_id": str(parent),
                "expected_model_revision": 1,
            },
        )
        assert sent.status_code == 200, sent.text
        return uuid.UUID(sent.json()["id"])

    turn = await revise("Write it now, please.", no_block)
    assert (await draft(r, chat.info.id)).json()["status"] == "pending"
    bad = await answer(r, chat, reply(GOOD.replace("essay-feedback", "Essay Feedback")), turn)
    body = (await draft(r, chat.info.id)).json()
    assert body["status"] == "invalid" and body["message_id"] == str(bad)
    assert "lowercase" in body["error"] and body["content"].startswith("---\nname: Essay Feedback")

    turn = await revise("Fix the name.", bad)
    good = await answer(r, chat, reply(GOOD), turn)
    body = (await draft(r, chat.info.id)).json()
    assert body == {
        "chat_id": str(chat.info.id),
        "status": "ready",
        "message_id": str(good),
        "content": GOOD,
        "name": "essay-feedback",
        "description": "Gives structured feedback on student essays.",
        "error": None,
    }
    # Saving is the normal create path; the draft itself never became a skill.
    assert (await r.client.get("/skills/", headers=auth())).json()["total"] == 0
    saved = await r.client.post("/skills/", headers=auth(), json={"content": body["content"]})
    assert saved.status_code == 201, saved.text


async def test_a_draft_cannot_activate_skills_or_compare(runtime):
    r = runtime
    await set_policy(r, True)
    chat = await started(r)
    reply_id = await answer(r, chat, reply(GOOD), chat.messages[0].id)
    base = {
        "request_id": str(uuid.uuid4()),
        "user_prompt": "Shorter",
        "parent_message_id": str(reply_id),
        "expected_model_revision": 1,
    }
    for extra in [
        {"skills": {"expected_revision": 0, "skill_ids": [str(uuid.uuid4())]}},
        {"compare": [{"model_id": MODEL}, {"model_id": str(uuid.UUID(int=1))}]},
    ]:
        sent = await r.client.post(f"/chat/{chat.info.id}/message", headers=auth(), json={**base, **extra})
        assert sent.status_code == 400, sent.text
    await set_policy(r, False)
    sent = await r.client.post(f"/chat/{chat.info.id}/message", headers=auth(), json=base)
    assert sent.status_code == 403, sent.text


async def test_the_start_payload_is_bounded(runtime):
    r = runtime
    await set_policy(r, True)
    assert (await start(r, description="")).status_code == 422
    assert (await start(r, examples="x" * 8001)).status_code == 422
    assert (await start(r, unknown=True)).status_code == 422
    chat = await started(r, examples="Input: an essay. Output: three comments.")
    assert "Examples of how it should work:\n\nInput: an essay." in chat.messages[0].content


async def test_a_cancelled_turn_keeps_the_previous_draft(runtime):
    r = runtime
    await set_policy(r, True)
    chat = await started(r)
    first = chat.messages[0].id
    async with r.sessions() as db:
        await db.execute(update(MessageModel).where(MessageModel.id == first).values(status=MessageStatus.CANCELLED))
        await db.commit()
    # Cancelling the opening run leaves nothing to review.
    assert (await draft(r, chat.info.id)).json()["status"] == "none"

    good = await answer(r, chat, reply(GOOD), first)
    sent = await r.client.post(
        f"/chat/{chat.info.id}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Make it longer",
            "parent_message_id": str(good),
            "expected_model_revision": 1,
        },
    )
    turn = uuid.UUID(sent.json()["id"])
    async with r.sessions() as db:
        await add_message(
            "a",
            chat.info.id,
            NewMessageRequest(
                model_id=uuid.UUID(MODEL),
                role="assistant",
                content="Here is a longer ver",
                parent_message_id=turn,
                status=MessageStatus.CANCELLED,
            ),
            session=db,
        )
        await db.execute(update(MessageModel).where(MessageModel.id == turn).values(status=MessageStatus.CANCELLED))
        await db.commit()
    body = (await draft(r, chat.info.id)).json()
    assert body["status"] == "ready" and body["message_id"] == str(good)
