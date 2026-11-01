"""Learning modes: server-owned layers pinned at acceptance, replayed on resume."""

import uuid
from dataclasses import replace

import pytest
from asterism.core.exceptions import CodedException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.execution_scope import ModelIdentity
from asterism.domains.agent.learning_inputs import LearningModeId
from asterism.domains.agent.prompts import PromptComposer, PromptLayer
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import MessageModel
from asterism.domains.chat.service import get_one
from asterism.domains.learning import catalog
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from test_chat_models import B, new_chat
from test_persona_execution import edit_persona, profiles
from test_project_sub_agents import runtime_setup
from test_projects_api import auth
from test_projects_api import project_api as _project_api
from test_skill_execution import finish, selection, send
from test_skill_execution import setup as setup_skills
from test_skills import skills_api as _skills_api

project_api = _project_api
skills_api = _skills_api


def mode_path(chat_id):
    return f"/chat/{chat_id}/learning-mode"


async def select_mode(client, chat_id, mode, revision):
    response = await client.put(
        mode_path(chat_id),
        headers=auth(),
        json={"learning_mode": mode, "expected_learning_mode_revision": revision},
    )
    assert response.status_code == 200, response.text
    return response.json()


def revised(mode_id, instructions, version):
    """The catalog with ``mode_id`` replaced by a newer revision."""
    modes = dict(catalog.LEARNING_MODES)
    modes[mode_id] = replace(modes[mode_id], instructions=instructions, version=version)
    return modes


async def pending_prompt(sessions, message_id):
    async with sessions() as db:
        return (await db.get(MessageModel, message_id)).pending_prompt


@pytest.mark.asyncio
async def test_catalog_lists_the_four_modes_without_instruction_text(project_api):
    client, _, _ = project_api
    assert (await client.get("/learning-modes")).status_code == 401
    response = await client.get("/learning-modes", headers=auth())
    assert response.status_code == 200, response.text
    modes = response.json()["modes"]
    assert [mode["id"] for mode in modes] == ["standard", "tutor", "explain_back", "review"]
    assert [mode["name"] for mode in modes] == ["Standard", "Tutor", "Explain-back", "Review my work"]
    assert all(
        set(mode) == {"id", "name", "description", "version", "hint_levels", "feedback_sections"} for mode in modes
    )
    assert "guiding questions" not in response.text


@pytest.mark.asyncio
async def test_acceptance_pins_the_mode_and_records_provenance(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    assert chat["info"]["learning_mode"] == "tutor"
    assert chat["info"]["learning_mode_revision"] == 1
    assert chat["messages"][0]["learning_mode"] == {"id": "tutor", "name": "Tutor", "version": 2, "hint_level": "none"}
    # Changing the selection after acceptance does not rewrite the accepted turn.
    await select_mode(client, cid, "review", 1)
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    assert execution.learning_mode.id == LearningModeId.TUTOR
    prompt = await pending_prompt(sessions, mid)
    assert "do not give the final answer" in prompt.text
    assert "first error or the weakest point" not in prompt.text
    layer = next(layer for layer in prompt.layers if layer.kind == "mode")
    assert (layer.source_id, layer.revision) == ("tutor", 2)
    state = (await client.get(f"/chat/{cid}", headers=auth())).json()
    assert state["messages"][0]["learning_mode"]["id"] == "tutor"
    assert state["info"]["pending_learning_mode"]["id"] == "tutor"
    assert state["info"]["learning_mode"] == "review"
    assert "do not give the final answer" not in str(state)


@pytest.mark.asyncio
async def test_resume_keeps_pinned_text_and_regeneration_captures_the_current_selection(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        first = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    monkeypatch.setattr(catalog, "LEARNING_MODES", revised(LearningModeId.TUTOR, "Revised tutor text", 3))
    async with sessions() as db:
        resumed = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    assert resumed == first
    assert "Revised tutor text" not in (await pending_prompt(sessions, mid)).text
    await select_mode(client, cid, "explain_back", 1)
    async with sessions() as db:
        regenerated = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True, session=db)
    assert regenerated.id != first.id
    assert regenerated.learning_mode.id == LearningModeId.EXPLAIN_BACK
    assert "explain the topic in\n  their own words" in (await pending_prompt(sessions, mid)).text
    # Regeneration into the same mode picks up its latest revision.
    await select_mode(client, cid, "tutor", 2)
    async with sessions() as db:
        latest = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True, session=db)
    assert (latest.learning_mode.id, latest.learning_mode.version) == (LearningModeId.TUTOR, 3)
    assert "Revised tutor text" in (await pending_prompt(sessions, mid)).text


@pytest.mark.asyncio
async def test_unpinned_first_run_uses_the_accepted_text_after_a_catalog_revision(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="review")
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    monkeypatch.setattr(catalog, "LEARNING_MODES", revised(LearningModeId.REVIEW, "Revised review text", 3))
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    assert execution.learning_mode.version == 2
    prompt = (await pending_prompt(sessions, mid)).text
    assert "Find the first error" in prompt and "Revised review text" not in prompt


@pytest.mark.asyncio
async def test_a_retired_mode_blocks_execution_until_regenerated_with_an_offered_mode(project_api, monkeypatch):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    retired = {key: value for key, value in catalog.LEARNING_MODES.items() if key != LearningModeId.TUTOR}
    monkeypatch.setattr(catalog, "LEARNING_MODES", retired)
    async with sessions() as db:
        with pytest.raises(CodedException, match="Learning mode is unavailable"):
            await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    await select_mode(client, cid, "standard", 1)
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True, session=db)
        assert execution.learning_mode.id == LearningModeId.STANDARD
        monkeypatch.setattr(catalog, "LEARNING_MODES", {})
        with pytest.raises(CodedException, match="Learning mode is unavailable"):
            await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)


@pytest.mark.asyncio
async def test_selection_requires_owner_revision_and_a_known_mode(project_api):
    client, _, _ = project_api
    chat = await new_chat(client)
    cid = chat["info"]["id"]
    assert chat["info"]["learning_mode"] == "standard"
    body = {"learning_mode": "tutor", "expected_learning_mode_revision": 1}
    assert (await client.put(mode_path(cid), headers=auth("b"), json=body)).status_code == 404
    assert (await client.put(mode_path(uuid.uuid4()), headers=auth(), json=body)).status_code == 404
    unknown = {"learning_mode": "answers_only", "expected_learning_mode_revision": 1}
    assert (await client.put(mode_path(cid), headers=auth(), json=unknown)).status_code == 422
    assert (await select_mode(client, cid, "tutor", 1))["learning_mode_revision"] == 2
    assert (await client.put(mode_path(cid), headers=auth(), json=body)).status_code == 409
    # Reselecting the current mode is a no-op that keeps the revision.
    assert (await select_mode(client, cid, "tutor", 2))["learning_mode_revision"] == 2
    bad_new = await client.post(
        "/chat/",
        headers=auth(),
        json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": B, "learning_mode": "nope"},
    )
    assert bad_new.status_code == 422


@pytest.mark.asyncio
async def test_each_turn_pins_the_selection_at_its_own_acceptance(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client, learning_mode="tutor")
    cid, first = chat["info"]["id"], chat["messages"][0]["id"]
    await finish(sessions, first)
    await select_mode(client, cid, "explain_back", 1)
    response = await send(client, cid, first)
    assert response.status_code == 200, response.text
    assert response.json()["learning_mode"]["id"] == "explain_back"
    async with sessions() as db:
        accepted = (await db.get(MessageModel, uuid.UUID(first))).accepted_learning_mode
        assert accepted.id == LearningModeId.TUTOR
        with pytest.raises(IntegrityError, match="immutable"):
            await db.execute(
                update(MessageModel).where(MessageModel.id == uuid.UUID(first)).values(accepted_learning_mode=None)
            )
            await db.commit()
        await db.rollback()


@pytest.mark.asyncio
async def test_mode_layers_between_persona_and_skills(skills_api):
    client, sessions, _ = skills_api
    skills = await setup_skills(client)
    persona = (await profiles(client))["profiles"][0]
    await edit_persona(client, persona, "Persona: I am a first-year student")
    chat = await new_chat(client, learning_mode="tutor", skills=selection([skills[0]["id"]]))
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    prompt = (await pending_prompt(sessions, mid)).text
    assert [source.kind for source in execution.prompt.sources] == [
        "platform",
        "agent",
        "profile",
        "mode",
        "skills",
        "runtime",
    ]
    assert prompt.index("first-year student") < prompt.index("do not give the final answer")
    assert prompt.index("do not give the final answer") < prompt.index("Private instructions 0")


@pytest.mark.asyncio
async def test_standard_mode_records_provenance_but_adds_no_instruction_text(project_api):
    client, sessions, _ = project_api
    chat = await new_chat(client)
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    assert execution.learning_mode.id == LearningModeId.STANDARD
    prompt = await pending_prompt(sessions, mid)
    assert "[mode instructions]" not in prompt.text
    assert any(source.kind == "mode" for source in execution.prompt.sources)


def test_composer_orders_mode_after_profile_and_before_project():
    agent_id, project_id = uuid.uuid4(), uuid.uuid4()
    snapshot = PromptComposer().snapshot(
        agent_id=agent_id,
        agent_revision=1,
        agent_instructions="Agent",
        project_id=project_id,
        project_revision=1,
        project_instructions="Project task",
        profile_layer=PromptLayer(kind="profile", source_id="p", revision=1, text="Persona"),
        mode_layer=PromptLayer(kind="mode", source_id="tutor", revision=1, text="Mode text"),
    )
    assert [layer.kind for layer in snapshot.layers] == ["platform", "agent", "profile", "mode", "project", "runtime"]
    assert snapshot.text.index("Persona") < snapshot.text.index("Mode text") < snapshot.text.index("Project task")
    with pytest.raises(ValueError, match="learning-mode"):
        PromptComposer().snapshot(
            agent_id=agent_id,
            agent_revision=1,
            agent_instructions="",
            mode_layer=PromptLayer(kind="profile", source_id="p", revision=1, text=""),
        )


@pytest.mark.asyncio
async def test_delegates_do_not_inherit_the_learning_mode(project_api, monkeypatch):
    client, _, p, _, worker, _, _ = await runtime_setup(project_api, monkeypatch)
    chat = await new_chat(client, project_id=p["id"], learning_mode="tutor")
    main = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=await get_one(uuid.UUID(chat["info"]["id"]), "a"),
        model_id=uuid.UUID(B),
    )
    await main.prepare_execution(uuid.UUID(chat["messages"][0]["id"]))
    scope = await main.prepare_execution_scope()
    assert "do not give the final answer" in await main._build_system_prompt()
    profile = await get_agent_profile("a", uuid.UUID(worker["id"]))
    child = Agent(
        profile=profile,
        user=main.user,
        session=main.session,
        execution_scope=scope.narrow_for_sub_agent(
            agent_id=profile.id,
            executed_model=ModelIdentity(id=profile.model_id),
            configuration_revision=profile.config_revision,
            effective_internal_tools=frozenset(),
        ),
        tool_scope=replace(main.tool_scope, caller_agent_id=profile.id, model_id=profile.model_id),
    )
    text = await child._build_system_prompt()
    assert "do not give the final answer" not in text
    assert all(layer.kind != "mode" for layer in child.prompt_snapshot.layers)
