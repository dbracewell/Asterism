"""US-58.1: project learning goals, included in a chat turn only when the learner asks."""

import uuid

import pytest
from asterism.domains.chat.models import MessageModel
from asterism.domains.projects.goals import GoalSnapshot, render_goal
from sqlalchemy import update
from sqlalchemy.exc import DatabaseError
from test_chat_models import A
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


async def create_project(client, **fields):
    response = await client.post("/projects/", headers=auth(), json={"name": "Essay", **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def send_new(client, project_id=None, include_goal=True, prompt="Help me plan"):
    payload = {"request_id": str(uuid.uuid4()), "user_prompt": prompt, "model_id": A, "include_goal": include_goal}
    if project_id is not None:
        payload["project_id"] = project_id
    return await client.post("/chat/", headers=auth(), json=payload)


@pytest.mark.asyncio
async def test_goal_fields_are_project_metadata(project_api):
    client, _, _ = project_api
    project = await create_project(
        client, goal="Write a 1,500-word essay on the Silk Road", goal_target_date="2026-12-01"
    )
    assert project["goal"] == "Write a 1,500-word essay on the Silk Road"
    assert project["goal_target_date"] == "2026-12-01"
    pid, revision = project["id"], project["context_revision"]
    updated = await client.patch(
        f"/projects/{pid}", headers=auth(), json={"expected_context_revision": revision, "goal": "Pass the exam"}
    )
    assert updated.status_code == 200, updated.text
    # Goal edits are metadata: they never advance the context revision.
    assert updated.json()["goal"] == "Pass the exam" and updated.json()["context_revision"] == revision
    assert updated.json()["goal_target_date"] == "2026-12-01"
    cleared = await client.patch(
        f"/projects/{pid}", headers=auth(), json={"expected_context_revision": revision, "goal_target_date": None}
    )
    assert cleared.json()["goal_target_date"] is None
    for body in ({"goal": None}, {"goal": "x" * 1001}, {"goal_target_date": "next week"}):
        response = await client.patch(
            f"/projects/{pid}", headers=auth(), json={"expected_context_revision": revision, **body}
        )
        assert response.status_code == 422, body
    assert (await create_project(client, name="Plain"))["goal"] == ""


@pytest.mark.asyncio
async def test_included_goal_is_pinned_on_the_turn_and_read_by_the_model(project_api, monkeypatch):
    client, sessions, _ = project_api
    project = await create_project(client, goal="  Write a lab report on enzymes  ", goal_target_date="2026-11-20")
    response = await send_new(client, project["id"])
    assert response.status_code == 200, response.text
    chat = response.json()
    goal = chat["messages"][0]["goal"]
    assert goal == {"project_id": project["id"], "text": "Write a lab report on enzymes", "target_date": "2026-11-20"}
    cid = chat["info"]["id"]
    # A later edit does not change what the turn recorded.
    await client.patch(
        f"/projects/{project['id']}",
        headers=auth(),
        json={"expected_context_revision": project["context_revision"], "goal": "Something else"},
    )
    history = (await client.get(f"/chat/{cid}", headers=auth())).json()["messages"]
    assert history[0]["goal"]["text"] == "Write a lab report on enzymes"
    log = (await client.post("/chat/ai-use-log", headers=auth(), json={"chat_ids": [cid]})).json()
    assert log["chats"][0]["turns"][0]["goal"] == "Write a lab report on enzymes"

    from asterism.core.schemas import AuthedUser
    from asterism.domains.agent.agent import Agent
    from asterism.domains.agent.service import get_main_agent_profile
    from asterism.domains.chat.orchestrator import ChatOrchestrator
    from asterism.domains.chat.service import get_one
    from test_chat_comparisons import Runtime

    Runtime(uuid.UUID(cid), sessions, monkeypatch)
    async with sessions() as session:
        opened = await get_one(uuid.UUID(cid), "a", session)
        profile = await get_main_agent_profile("a", session)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", name="A", email="a@example.test", role="user"),
        session=opened,
        model_id=opened.info.selected_model_id,
    )
    messages, _ = await ChatOrchestrator(agent)._assemble_agent_messages()
    parts = messages[0].content
    assert isinstance(parts, list)
    assert [part.text for part in parts] == [  # type: ignore[union-attr]
        "Help me plan",
        render_goal(GoalSnapshot.model_validate(goal)),
    ]
    assert "Target date: 2026-11-20" in parts[1].text  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_goal_is_only_included_on_request_and_needs_a_project_goal(project_api):
    client, sessions, _ = project_api
    with_goal = await create_project(client, goal="Learn calculus")
    without = await create_project(client, name="No goal")
    default = await send_new(client, with_goal["id"], include_goal=False)
    assert default.status_code == 200 and default.json()["messages"][0]["goal"] is None
    assert (await send_new(client, without["id"])).status_code == 400
    assert (await send_new(client)).status_code == 400
    # Follow-up turns choose again; the goal is never inherited.
    chat = default.json()
    cid = chat["info"]["id"]
    async with sessions() as session:
        await session.execute(
            update(MessageModel)
            .where(MessageModel.id == uuid.UUID(chat["messages"][0]["id"]))
            .values(status="completed")
        )
        await session.commit()
    sent = await client.post(
        f"/chat/{cid}/message",
        headers=auth(),
        json={
            "request_id": str(uuid.uuid4()),
            "user_prompt": "Now with the goal",
            "parent_message_id": chat["messages"][0]["id"],
            "expected_model_revision": 1,
            "include_goal": True,
        },
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["goal"]["text"] == "Learn calculus"


@pytest.mark.asyncio
async def test_accepted_goal_is_immutable(project_api):
    client, sessions, _ = project_api
    project = await create_project(client, goal="Learn calculus")
    chat = (await send_new(client, project["id"])).json()
    mid = uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        with pytest.raises(DatabaseError, match="immutable"):
            await db.execute(update(MessageModel).where(MessageModel.id == mid).values(accepted_goal=None))
            await db.commit()
