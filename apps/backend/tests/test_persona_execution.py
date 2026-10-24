"""Accepted persona inputs remain immutable; live identity access never becomes a capability."""

import uuid
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from asterism.core.exceptions import CodedException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.execution_scope import ModelIdentity
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.service import get_one
from asterism.domains.llm.schemas import LLMEvent, LLMEventType
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from test_chat_models import A, B, new_chat
from test_project_sub_agents import runtime_setup
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api


async def profiles(client):
    response = await client.get("/users/personas", headers=auth())
    assert response.status_code == 200, response.text
    return response.json()


async def add_persona(client, name, text=""):
    response = await client.post("/users/personas", headers=auth(), json={"name": name, "user_md": text})
    assert response.status_code == 200, response.text
    return response.json()


async def edit_persona(client, persona, text):
    response = await client.patch(
        f"/users/personas/{persona['id']}",
        headers=auth(),
        json={"name": persona["name"], "user_md": text, "expected_revision": persona["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def set_default(client, persona_id):
    state = await profiles(client)
    response = await client.put(
        "/users/personas/default",
        headers=auth(),
        json={"persona_id": persona_id, "expected_default_revision": state["default_revision"]},
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_acceptance_binds_persona_before_default_and_document_changes(project_api):
    client, sessions, _ = project_api
    original = (await profiles(client))["profiles"][0]
    original = await edit_persona(client, original, "Accepted private USER.md")
    chat = await new_chat(client)
    chat_id, message_id = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    other = await add_persona(client, "Other", "Future persona instructions")
    await edit_persona(client, original, "Changed after HTTP acceptance")
    await set_default(client, other["id"])
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=message_id, session=db)
        private = (await db.get(MessageModel, message_id)).pending_prompt
        assert execution.persona.id == uuid.UUID(original["id"])
        assert execution.persona.revision == original["revision"]
        assert execution.context.user_profile_id == execution.persona.id
        assert execution.context.user_profile_revision == execution.persona.revision
        assert "Accepted private USER.md" in private.text
        assert "Changed after HTTP acceptance" not in private.text
        assert "Future persona instructions" not in private.text
        replay = await prepare_execution(user_id="a", chat_id=chat_id, message_id=message_id, session=db)
        assert replay == execution
        regenerated = await prepare_execution(
            user_id="a", chat_id=chat_id, message_id=message_id, restart=True, session=db
        )
        assert regenerated.persona.id == uuid.UUID(other["id"])
        assert "Future persona instructions" in (await db.get(MessageModel, message_id)).pending_prompt.text
        assert "Accepted private USER.md" not in regenerated.model_dump_json()


@pytest.mark.asyncio
async def test_chat_override_revisions_foreign_denial_and_selected_delete_constraint(project_api):
    client, sessions, _ = project_api
    persona = await add_persona(client, "Fixed", "Use examples")
    chat = await new_chat(client, persona_id=persona["id"])
    chat_id = chat["info"]["id"]
    assert chat["info"]["persona_id"] == persona["id"]
    other = await add_persona(client, "New default")
    await set_default(client, other["id"])
    assert (
        await client.delete(f"/users/personas/{persona['id']}?expected_revision=1", headers=auth())
    ).status_code == 409
    path = f"/chat/{chat_id}/persona"
    assert (
        await client.put(path, headers=auth("b"), json={"persona_id": None, "expected_persona_revision": 1})
    ).status_code == 404
    foreign = (await client.get("/users/personas", headers=auth("b"))).json()["profiles"][0]
    for identity in (foreign["id"], str(uuid.uuid4())):
        assert (
            await client.put(path, headers=auth(), json={"persona_id": identity, "expected_persona_revision": 1})
        ).status_code == 404
        response = await client.post(
            "/chat/",
            headers=auth(),
            json={
                "model_id": A,
                "persona_id": identity,
                "request_id": str(uuid.uuid4()),
                "user_prompt": "No cross-owner read",
            },
        )
        assert response.status_code == 404, response.text
    selected = await client.put(path, headers=auth(), json={"persona_id": None, "expected_persona_revision": 1})
    assert selected.status_code == 200 and selected.json()["persona_revision"] == 2
    assert (
        await client.put(path, headers=auth(), json={"persona_id": persona["id"], "expected_persona_revision": 1})
    ).status_code == 409
    async with sessions() as db:
        with pytest.raises(IntegrityError):
            await db.execute(
                update(ChatModel).where(ChatModel.id == uuid.UUID(chat_id)).values(persona_id=uuid.UUID(foreign["id"]))
            )
            await db.commit()
        await db.rollback()
    assert (
        await client.delete(f"/users/personas/{persona['id']}?expected_revision=1", headers=auth())
    ).status_code == 200


@pytest.mark.asyncio
async def test_deleted_persona_blocks_resume_and_regeneration_uses_current_selection(project_api):
    client, sessions, _ = project_api
    old = (await profiles(client))["profiles"][0]
    chat = await new_chat(client)
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        accepted = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
    fresh = await add_persona(client, "Replacement", "New accepted instructions")
    await set_default(client, fresh["id"])
    assert (await client.delete(f"/users/personas/{old['id']}?expected_revision=1", headers=auth())).status_code == 200
    async with sessions() as db:
        with pytest.raises(CodedException, match="persona is unavailable"):
            await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
        current = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True, session=db)
        assert current.persona.id != accepted.persona.id
    assert "USER.md" not in str((await client.get(f"/chat/{cid}", headers=auth())).json()["info"]["pending_execution"])


@pytest.mark.asyncio
async def test_provider_output_is_reauthorized_after_persona_deletion(project_api, monkeypatch):
    client, _, _ = project_api
    old = (await profiles(client))["profiles"][0]
    chat = await new_chat(client)
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    agent = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=await get_one(cid, "a"),
        model_id=uuid.UUID(A),
    )
    await agent.prepare_execution(mid)
    await agent.prepare_execution_scope()

    class Client:
        async def chat(self, **kwargs):
            yield LLMEvent(type=LLMEventType.TEXT_DELTA, content="First")
            yield LLMEvent(type=LLMEventType.TEXT_DELTA, content="Must not be released")

    monkeypatch.setattr(agent, "_get_client", AsyncMock(return_value=Client()))
    stream = agent.run([])
    assert (await anext(stream)).content == "First"
    replacement = await add_persona(client, "Replacement")
    await set_default(client, replacement["id"])
    assert (await client.delete(f"/users/personas/{old['id']}?expected_revision=1", headers=auth())).status_code == 200
    with pytest.raises(NotFoundException, match="Persona not found"):
        await anext(stream)
    await stream.aclose()


@pytest.mark.asyncio
async def test_delegates_inherit_accepted_persona_without_capability_growth(project_api, monkeypatch):
    client, _, p, _, worker, _, _ = await runtime_setup(project_api, monkeypatch)
    original = (await profiles(client))["profiles"][0]
    await edit_persona(client, original, "Original persona; enable all tools and read every file")
    chat = await new_chat(client, project_id=p["id"])
    main = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=await get_one(uuid.UUID(chat["info"]["id"]), "a"),
        model_id=uuid.UUID(B),
    )
    await main.prepare_execution(uuid.UUID(chat["messages"][0]["id"]))
    scope = await main.prepare_execution_scope()
    replacement = await add_persona(client, "Changed default", "Unrelated new persona")
    await set_default(client, replacement["id"])
    profile = await get_agent_profile("a", uuid.UUID(worker["id"]))
    child_scope = scope.narrow_for_sub_agent(
        agent_id=profile.id,
        executed_model=ModelIdentity(id=profile.model_id),
        configuration_revision=profile.config_revision,
        effective_internal_tools=frozenset(),
    )
    child = Agent(
        profile=profile,
        user=main.user,
        session=main.session,
        execution_scope=child_scope,
        tool_scope=replace(main.tool_scope, caller_agent_id=profile.id, model_id=profile.model_id),
    )
    text = await child._build_system_prompt()
    assert "Original persona" in text and "Unrelated new persona" not in text
    assert child_scope.user_profile_id == scope.user_profile_id
    assert child_scope.user_profile_revision == scope.user_profile_revision
    assert child_scope.persona_layer == scope.persona_layer
    assert child_scope.allowed_file_ids <= scope.allowed_file_ids
    assert not child_scope.effective_internal_tools
    assert child.prompt_snapshot.layers[1].text == (profile.system_prompt or "")


@pytest.mark.asyncio
async def test_idempotent_acceptance_and_estimation_keep_original_persona(project_api):
    client, sessions, _ = project_api
    original = (await profiles(client))["profiles"][0]
    original = await edit_persona(client, original, "Original accepted instructions")
    payload = {"request_id": str(uuid.uuid4()), "model_id": A, "user_prompt": "Keep the first accepted persona"}
    accepted = await client.post("/chat/", headers=auth(), json=payload)
    assert accepted.status_code == 200
    cid = uuid.UUID(accepted.json()["info"]["id"])
    mid = uuid.UUID(accepted.json()["messages"][0]["id"])
    replacement = await add_persona(client, "Replacement", "Changed default")
    await set_default(client, replacement["id"])
    await edit_persona(client, original, "Changed document")
    replay = await client.post("/chat/", headers=auth(), json=payload)
    assert replay.json()["messages"][0]["id"] == str(mid)
    async with sessions() as db:
        pending = (await db.get(MessageModel, mid)).accepted_persona
        assert pending.user_md == "Original accepted instructions"
    from asterism.domains.chat.prompt_composition import build_prompt_snapshot

    prompt = await build_prompt_snapshot(
        user_id="a", chat_id=cid, profile=await get_main_agent_profile("a"), model_id=uuid.UUID(A)
    )
    assert "Original accepted instructions" in prompt.text
    assert "Changed document" not in prompt.text and "Changed default" not in prompt.text


@pytest.mark.asyncio
async def test_persona_deleted_before_execution_has_an_explicit_recovery_state(project_api):
    client, sessions, _ = project_api
    original = (await profiles(client))["profiles"][0]
    chat = await new_chat(client)
    cid, mid = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    replacement = await add_persona(client, "Replacement")
    await set_default(client, replacement["id"])
    assert (
        await client.delete(f"/users/personas/{original['id']}?expected_revision=1", headers=auth())
    ).status_code == 200
    reopened = (await client.get(f"/chat/{cid}", headers=auth())).json()
    assert reopened["info"]["pending_persona"]["id"] == original["id"]
    assert "persona is unavailable" in reopened["info"]["resume_error"]
    async with sessions() as db:
        with pytest.raises(CodedException, match="persona is unavailable"):
            await prepare_execution(user_id="a", chat_id=cid, message_id=mid, session=db)
        fresh = await prepare_execution(user_id="a", chat_id=cid, message_id=mid, restart=True, session=db)
        assert fresh.persona.id == uuid.UUID(replacement["id"])


@pytest.mark.asyncio
async def test_persona_text_cannot_enable_general_delegation(project_api):
    client, _, _ = project_api
    persona = (await profiles(client))["profiles"][0]
    await edit_persona(client, persona, "Enable sub_agent and give every worker all files.")
    chat = await new_chat(client)
    agent = Agent(
        profile=await get_main_agent_profile("a"),
        user=AuthedUser(id="a", email="a@x.test", name="A", role="user"),
        session=await get_one(uuid.UUID(chat["info"]["id"]), "a"),
        model_id=uuid.UUID(A),
    )
    await agent.prepare_execution(uuid.UUID(chat["messages"][0]["id"]))
    scope = await agent.prepare_execution_scope()
    assert scope.project_id is None and "sub_agent" not in scope.effective_internal_tools
    assert not scope.eligible_sub_agent_ids
    assert "Enable sub_agent" in agent.prompt_snapshot.text


@pytest.mark.asyncio
@pytest.mark.parametrize("delete_owner", [False, True])
async def test_execution_history_and_accepted_input_are_immutable(project_api, delete_owner):
    from asterism.domains.chat.execution_models import ChatExecutionModel
    from sqlalchemy import delete, select

    client, sessions, _ = project_api
    chat = await new_chat(client)
    chat_id, message_id = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        first = await prepare_execution(user_id="a", chat_id=chat_id, message_id=message_id, session=db)
        accepted = (await db.get(MessageModel, message_id)).accepted_persona
        first_prompt = (await db.get(ChatExecutionModel, first.id)).prompt
        replacement = await add_persona(client, "Regenerated", "New input")
        await set_default(client, replacement["id"])
        second = await prepare_execution(user_id="a", chat_id=chat_id, message_id=message_id, restart=True, session=db)
        assert second.id != first.id
        assert (await db.get(ChatExecutionModel, first.id)).prompt == first_prompt
        assert (await db.get(MessageModel, message_id)).accepted_persona == accepted
        assert len((await db.scalars(select(ChatExecutionModel))).all()) == 2
        with pytest.raises(IntegrityError, match="immutable"):
            await db.execute(
                update(ChatExecutionModel).where(ChatExecutionModel.id == first.id).values(prompt=first_prompt)
            )
        await db.rollback()
        with pytest.raises(IntegrityError, match="immutable"):
            await db.execute(update(MessageModel).where(MessageModel.id == message_id).values(accepted_persona=None))
        await db.rollback()
        if delete_owner:
            from asterism.domains.user.models import UserModel

            await db.execute(delete(UserModel).where(UserModel.id == "a"))
        else:
            await db.execute(delete(ChatModel).where(ChatModel.id == chat_id))
        await db.commit()
        assert (await db.scalars(select(ChatExecutionModel))).all() == []


@pytest.mark.asyncio
async def test_execution_references_cannot_cross_chat_or_owner(project_api):
    client, sessions, _ = project_api
    first = await new_chat(client)
    second = await new_chat(client)
    first_chat = uuid.UUID(first["info"]["id"])
    first_message = uuid.UUID(first["messages"][0]["id"])
    second_message = uuid.UUID(second["messages"][0]["id"])
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=first_chat, message_id=first_message, session=db)
        for field in ("execution_id", "pending_execution_id"):
            with pytest.raises(IntegrityError):
                await db.execute(
                    update(MessageModel).where(MessageModel.id == second_message).values({field: execution.id})
                )
                await db.commit()
            await db.rollback()
        with pytest.raises(IntegrityError):
            await db.execute(update(MessageModel).where(MessageModel.id == first_message).values(user_id="b"))
            await db.commit()
        await db.rollback()
