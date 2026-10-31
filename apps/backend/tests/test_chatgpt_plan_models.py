"""US-49.3: owner-scoped ChatGPT plan models in pickers, bindings and execution."""

import json
import uuid

import httpx
import pytest
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.chat.delegation import require_delegation_target
from asterism.domains.llm import client as llm_client
from asterism.domains.llm.errors import LLMProviderError
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.responses import ResponsesLLMClient
from asterism.domains.llm.schemas import LLMEventType, LLMMessage
from asterism.domains.settings import service as settings_service
from asterism.domains.settings.models import LLMModel, ProviderModel
from openai import AsyncOpenAI
from sqlalchemy import select
from test_chatgpt_connection import OAuthDouble, connect, enable
from test_chatgpt_connection import chatgpt as _chatgpt
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
chatgpt = _chatgpt
GLOBAL_A = str(uuid.UUID(int=1))


class ResponsesDouble:
    """Plan inference endpoint that records which bearer token each request used."""

    def __init__(self) -> None:
        self.tokens: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/responses"
        self.tokens.append(request.headers["authorization"])
        body = json.loads(request.content)
        assert (body["store"], body["stream"]) == (False, True)
        events = [
            {"type": "response.output_text.delta", "delta": "Plan reply", "item_id": "m", "output_index": 0,
             "content_index": 0, "logprobs": [], "sequence_number": 1},
            {"type": "response.completed", "sequence_number": 2, "response": {
                "id": "r", "object": "response", "created_at": 0, "model": body["model"], "status": "completed",
                "output": [], "parallel_tool_calls": True, "tool_choice": "auto", "tools": [], "usage": None}},
        ]  # fmt: skip
        content = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=content.encode())


@pytest.fixture
def plan(chatgpt, monkeypatch):
    client, sessions, double = chatgpt
    responses = ResponsesDouble()
    sdk = AsyncOpenAI(
        api_key="chatgpt-plan",
        base_url="https://api.openai.com/v1",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(responses.handle)),
    )
    monkeypatch.setitem(llm_client._shared_openai_clients, ("https://api.openai.com/v1", "chatgpt-plan"), sdk)
    return client, sessions, double, responses


async def plan_model_id(sessions, user="a", slug="gpt-plan") -> str:
    async with sessions() as session:
        model_id = await session.scalar(
            select(LLMModel.id)
            .join(LLMModel.provider)
            .where(ProviderModel.owner_user_id == user, LLMModel.name == slug),
        )
        assert model_id is not None
        return str(model_id)


async def choices(client, user="a") -> dict[str, dict]:
    response = await client.get("/chat/models", headers=auth(user))
    assert response.status_code == 200, response.text
    return {choice["id"]: choice for choice in response.json()}


async def sub_agent(client, model_id, user="a"):
    return await client.post(
        "/agents/sub-agents",
        headers=auth(user),
        json={"name": f"Plan {uuid.uuid4().hex[:6]}", "description": "Uses the plan", "model_id": model_id},
    )


async def resync(client, double: OAuthDouble, models):
    double.models = models
    response = await client.post("/chatgpt/connection/models", headers=auth("a"))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_connecting_syncs_listed_models_into_the_owners_pickers_only(plan):
    client, sessions, double, _ = plan
    await enable(client)
    await connect(client, double)

    assert double.model_tokens == ["Bearer access-1"]
    model_id = await plan_model_id(sessions)
    mine = await choices(client, "a")
    assert mine[model_id]["name"] == "gpt-plan"
    assert mine[model_id]["display_name"] == "GPT Plan"
    assert mine[model_id]["provider_type"] == "chatgpt"
    assert mine[model_id]["provider_name"] == "ChatGPT"
    assert mine[model_id]["available"] is True
    assert mine[model_id]["supports_tools"] is True
    assert not any(choice["name"] == "gpt-hidden" for choice in mine.values())
    assert (await client.get("/chatgpt/connection", headers=auth("a"))).json()["model_count"] == 1

    # Other users, user settings pickers and every admin-wide surface never see it.
    assert model_id not in await choices(client, "b")
    assert GLOBAL_A in await choices(client, "b")
    user_models = {m["id"] for m in (await client.get("/settings/user", headers=auth("a"))).json()["models"]}
    assert model_id in user_models
    other_models = {m["id"] for m in (await client.get("/settings/user", headers=auth("b"))).json()["models"]}
    assert model_id not in other_models
    async with sessions() as session:
        admin = await settings_service.get_provider_settings(session)
        assert {provider.name for provider in admin.llm_providers} == {"Chat test provider"}
        assert all(
            provider.provider_type != "chatgpt"
            for provider in (await settings_service.get_app_settings(session)).llm_providers
        )
        assert model_id not in {str(m.id) for m in await settings_service.get_captioning_models(session)}


@pytest.mark.asyncio
async def test_other_users_cannot_bind_or_run_a_plan_model(plan):
    client, sessions, double, _ = plan
    await enable(client)
    await connect(client, double)
    model_id = await plan_model_id(sessions)

    assert (await sub_agent(client, model_id, user="b")).status_code == 400
    bad_default = await client.put("/settings/user/default_model_id", headers=auth("b"), json={"value": model_id})
    assert bad_default.status_code == 400
    body = {"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": model_id}
    assert (await client.post("/chat/", headers=auth("b"), json=body)).status_code == 409

    with pytest.raises(NotFoundException):
        await settings_service.get_model_and_provider(uuid.UUID(model_id), user_id="b")
    with pytest.raises(NotFoundException):
        await settings_service.get_model_and_provider(uuid.UUID(model_id))
    model = await settings_service.get_model_and_provider(uuid.UUID(model_id), user_id="a")
    with pytest.raises(BadDataException):
        create_llm_client(model.name, model.provider, user_id="b")


@pytest.mark.asyncio
async def test_plan_requests_run_only_on_the_owners_connection(plan):
    client, sessions, double, responses = plan
    await enable(client)
    await connect(client, double)
    model = await settings_service.get_model_and_provider(uuid.UUID(await plan_model_id(sessions)), user_id="a")

    llm = create_llm_client(model.name, model.provider, user_id="a")
    assert isinstance(llm, ResponsesLLMClient)
    events = [event async for event in llm.chat(messages=[LLMMessage.user("Hi")], temperature=0.3)]

    assert events[-1].type == LLMEventType.COMPLETE
    assert events[-1].content == "Plan reply"
    assert responses.tokens == ["Bearer access-1"]

    await enable(client, False)
    failed = [event async for event in llm.chat(messages=[LLMMessage.user("Hi")])]
    assert [event.type for event in failed] == [LLMEventType.ERROR]
    assert isinstance(failed[0].exception, LLMProviderError)
    assert failed[0].exception.code == "chatgpt_plan_policy_disabled"
    assert responses.tokens == ["Bearer access-1"]


@pytest.mark.asyncio
async def test_bindings_stay_put_and_show_unavailable_as_availability_changes(plan):
    client, sessions, double, _ = plan
    await enable(client)
    await connect(client, double)
    model_id = await plan_model_id(sessions)
    created = await sub_agent(client, model_id)
    assert created.status_code == 201, created.text
    agent_id = created.json()["id"]
    chat = await client.post(
        "/chat/", headers=auth("a"), json={"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": model_id}
    )
    assert chat.status_code == 200, chat.text
    chat_id = chat.json()["info"]["id"]

    async def state():
        choice = (await choices(client))[model_id]
        items = (await client.get("/agents/sub-agents", headers=auth("a"))).json()["items"]
        definition = next(item for item in items if item["id"] == agent_id)
        info = (await client.get(f"/chat/{chat_id}", headers=auth("a"))).json()["info"]
        assert definition["model_id"] == model_id
        assert info["selected_model_id"] == model_id
        assert info["selected_model"]["available"] == choice["available"] == definition["model_available"]
        return choice["unavailable_reason"], definition["model_unavailable_reason"]

    assert await state() == (None, None)

    await enable(client, False)
    reason, sub_reason = await state()
    assert reason == sub_reason == "ChatGPT plans are turned off by your administrator"
    await enable(client)
    assert await state() == (None, None)

    # A model that leaves the account is deactivated, never deleted or swapped.
    await resync(client, double, [{"slug": "gpt-other", "display_name": "Other", "visibility": "list"}])
    reason, _ = await state()
    assert reason == "Model is no longer in your ChatGPT plan; choose another model"
    await resync(client, double, [{"slug": "gpt-plan", "display_name": "GPT Plan", "visibility": "list"}])
    assert await state() == (None, None)
    assert await plan_model_id(sessions) == model_id

    await client.post("/chatgpt/connection/disconnect", headers=auth("a"), json={})
    reason, _ = await state()
    assert reason == "Connect ChatGPT in User Settings to use this model"
    body = {"request_id": str(uuid.uuid4()), "user_prompt": "Hi", "model_id": model_id}
    assert (await client.post("/chat/", headers=auth("a"), json=body)).status_code == 409


@pytest.mark.asyncio
async def test_project_selected_plan_sub_agent_is_unavailable_for_delegation_when_the_plan_is(plan, monkeypatch):
    client, sessions, double, _ = plan
    await enable(client)
    await connect(client, double)
    model_id = await plan_model_id(sessions)
    agent = (await sub_agent(client, model_id)).json()
    project = (await client.post("/projects/", headers=auth("a"), json={"name": "Plan work"})).json()
    selected = await client.post(
        f"/projects/{project['id']}/sub-agents",
        headers=auth("a"),
        json={"agent_ids": [agent["id"]], "expected_context_revision": 1},
    )
    assert selected.status_code == 200, selected.text

    listed = (await client.get(f"/projects/{project['id']}/sub-agents", headers=auth("a"))).json()["agents"]
    assert [(item["id"], item["model_available"]) for item in listed] == [(agent["id"], True)]

    async def delegate():
        from asterism.domains.agent.delegation_scope import DelegationScope

        class Any(frozenset):
            def __contains__(self, item):
                return True

        scope = DelegationScope(
            chat_id=uuid.uuid4(), project_id=uuid.UUID(project["id"]), context_revision=2, agent_ids=Any()
        )
        monkeypatch.setattr("asterism.domains.chat.delegation.resolve_delegation_scope", _resolve(scope))
        async with sessions() as session:
            return await require_delegation_target(
                user_id="a", chat_id=scope.chat_id, target_id=uuid.UUID(agent["id"]), scope=scope, session=session
            )

    assert str((await delegate()).id) == agent["id"]
    await enable(client, False)
    listed = (await client.get(f"/projects/{project['id']}/sub-agents", headers=auth("a"))).json()["agents"]
    assert listed[0]["model_available"] is False
    assert listed[0]["model_id"] == model_id
    with pytest.raises(BadDataException, match="unavailable"):
        await delegate()


def _resolve(scope):
    async def resolve(**_):
        return scope

    return resolve


@pytest.mark.asyncio
async def test_admins_cannot_configure_chatgpt_providers(plan):
    client, sessions, _, _ = plan
    async with sessions() as session:
        settings = await settings_service.get_provider_settings(session)
        settings.llm_providers.append(
            settings.llm_providers[0].model_copy(
                update={"id": uuid.uuid4(), "name": "Mine", "provider_type": "chatgpt"}
            ),
        )
        with pytest.raises(BadDataException, match="connected by users"):
            await settings_service.update_provider_settings(settings, session)
