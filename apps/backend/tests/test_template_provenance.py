"""US-51.3: label-only template provenance on accepted user messages."""

import uuid

import pytest
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.schemas import MessageStatus, NewMessageRequest
from asterism.domains.chat.service import add_message, get_one
from sqlalchemy import update
from sqlalchemy.exc import DatabaseError
from test_chat_models import A, new_chat
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_prompt_templates import create as create_template
from test_prompt_templates import templates_api as _templates_api

project_api = _project_api
templates_api = _templates_api


def use(source="framework", id="rtf", revision=1, level="guided", **extra):
    return {"source": source, "id": id, "revision": revision, "level": level, **extra}


async def send(client, cid, parent, template=None, prompt="Follow up"):
    payload = {
        "request_id": str(uuid.uuid4()),
        "user_prompt": prompt,
        "parent_message_id": parent,
        "expected_model_revision": 1,
    }
    if template is not None:
        payload["template"] = template
    return await client.post(f"/chat/{cid}/message", headers=auth(), json=payload)


async def answer(cid, parent, content="Answer"):
    return await add_message(
        "a",
        uuid.UUID(cid),
        NewMessageRequest(
            model_id=uuid.UUID(A),
            role="assistant",
            content=content,
            parent_message_id=uuid.UUID(parent),
            status=MessageStatus.COMPLETED,
        ),
    )


@pytest.mark.asyncio
async def test_framework_and_template_labels_are_resolved_by_the_server(templates_api):
    client, _, _ = templates_api
    chat = await new_chat(client, template=use())
    first = chat["messages"][0]
    assert first["template"] == {
        "source": "framework",
        "id": "rtf",
        "revision": 1,
        "level": "guided",
        "name": "RTF",
        "available": True,
    }
    owned = await create_template(client, name="My brief")
    cid = chat["info"]["id"]
    reply = await answer(cid, first["id"])
    sent = await send(client, cid, str(reply.id), use("template", owned["id"].upper(), 1, level="standard"))
    assert sent.status_code == 200, sent.text
    label = sent.json()["template"]
    assert label["name"] == "My brief" and label["id"] == owned["id"] and label["level"] == "standard"


@pytest.mark.asyncio
@pytest.mark.parametrize("level", ["guided", "standard", "freeform"])
async def test_each_scaffolding_level_is_recorded(templates_api, level):
    client, _, _ = templates_api
    chat = await new_chat(client, template=use("framework", "co-star", 2, level))
    cid = chat["info"]["id"]
    history = (await client.get(f"/chat/{cid}", headers=auth())).json()["messages"]
    assert history[0]["template"]["level"] == level
    assert history[0]["template"]["revision"] == 2


@pytest.mark.asyncio
async def test_invalid_claims_reject_the_send_without_accepting_it(templates_api):
    client, sessions, _ = templates_api
    chat = await new_chat(client)
    cid, root = chat["info"]["id"], chat["messages"][0]["id"]
    reply = await answer(cid, root)
    foreign = await create_template(client, user="b")
    owned = await create_template(client)
    cases = [
        (use(id="missing"), 404),
        (use(revision=3), 400),
        (use("template", foreign["id"]), 404),
        (use("template", "not-a-uuid"), 404),
        (use("template", owned["id"], 2), 400),
        (use(level="expert"), 422),
        ({k: v for k, v in use().items() if k != "level"}, 422),
        (use(name="Spoofed"), 422),
        (use(revision=0), 422),
    ]
    for template, status in cases:
        response = await send(client, cid, str(reply.id), template)
        assert response.status_code == status, (template, response.text)
        body = await client.post(
            "/chat/",
            headers=auth(),
            json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": A, "template": template},
        )
        assert body.status_code == status, (template, body.text)
    messages = (await get_one(uuid.UUID(cid), "a")).messages
    assert [m.role for m in messages] == ["user", "assistant"]
    assert messages[0].template is None


@pytest.mark.asyncio
async def test_deleted_template_stays_labelled_as_unavailable(templates_api):
    client, _, _ = templates_api
    owned = await create_template(client, name="Gone soon")
    chat = await new_chat(client, template=use("template", owned["id"]))
    cid = chat["info"]["id"]
    assert chat["messages"][0]["template"]["available"] is True
    deleted = await client.delete(f"/prompt-templates/{owned['id']}?expected_revision=1", headers=auth())
    assert deleted.status_code == 204
    history = (await client.get(f"/chat/{cid}", headers=auth())).json()
    label = history["messages"][0]["template"]
    assert label["name"] == "Gone soon" and label["available"] is False
    # A different user's template with the same ID would never count as available.
    assert (await client.get(f"/chat/{cid}", headers=auth("b"))).status_code == 404


@pytest.mark.asyncio
async def test_labels_survive_regeneration_and_are_never_inherited(templates_api):
    client, _, _ = templates_api
    chat = await new_chat(client, template=use("framework", "co-star"))
    cid, root = chat["info"]["id"], chat["messages"][0]["id"]
    await answer(cid, root, "First answer")
    # Regenerating the answer adds an assistant sibling; the user label is unchanged.
    regenerated = await answer(cid, root, "Regenerated answer")
    messages = (await client.get(f"/chat/{cid}", headers=auth())).json()["messages"]
    assert messages[0]["template"]["id"] == "co-star"
    assert messages[1]["content"] == "Regenerated answer"
    followup = await send(client, cid, str(regenerated.id))
    assert followup.status_code == 200 and followup.json()["template"] is None
    history = (await client.get(f"/chat/{cid}", headers=auth())).json()["messages"]
    assert [m["template"] and m["template"]["id"] for m in history] == ["co-star", None, None]


@pytest.mark.asyncio
async def test_accepted_template_is_immutable(templates_api):
    client, sessions, _ = templates_api
    chat = await new_chat(client, template=use())
    mid = uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        with pytest.raises(DatabaseError, match="immutable"):
            await db.execute(update(MessageModel).where(MessageModel.id == mid).values(accepted_template=None))
            await db.commit()
