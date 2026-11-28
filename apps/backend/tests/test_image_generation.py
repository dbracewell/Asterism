"""US-76.1: image generation domain, generate_image and Create image (ADR-0064)."""

import asyncio
import io
import json
import uuid
from unittest.mock import AsyncMock

import pytest
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import AuthedUser, NoArgs
from asterism.domains.agent.agent import Agent
from asterism.domains.agent.schemas import AgentEventType, ToolProgress
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.chat.models import ChatFileModel, ChatModel
from asterism.domains.chat.service import get_one
from asterism.domains.chat.tool_policy import require_internal_tool, resolve_effective_tools
from asterism.domains.components.registry import component_registry
from asterism.domains.files.models import FileOrigin, UserFileModel
from asterism.domains.image_generation.models import ImageGenerationModel
from asterism.domains.image_generation.providers import ImageGenerationError, ImageGeneratorComponent
from asterism.domains.image_generation.safety import refusal_reason
from asterism.domains.image_generation.schemas import (
    ImageProgress,
    ImageProviderStatus,
    ImageRequest,
    ProviderImage,
    ProviderResult,
)
from asterism.domains.image_generation.service import generate_images
from asterism.domains.llm.schemas import Function, LLMEvent, LLMEventType, LLMMessage, ToolCall
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel
from asterism.domains.tools.builtin.image_generation import GenerateImageArgs, generate_image
from asterism.domains.tools.catalog import ToolPolicy, configurable_tools
from asterism.domains.tools.registry import tool_registry
from sqlalchemy import delete, select, update
from test_canvas import canvas_api as _canvas_api
from test_canvas import finish, scope_for, started_chat, tool_ctx
from test_chat_models import A
from test_project_sub_agents import worker
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
canvas_api = _canvas_api


def png(color=(200, 40, 40), size=(32, 24)) -> bytes:
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo

    out = io.BytesIO()
    meta = PngInfo()
    meta.add_text("workflow", '{"secret": "embedded"}')
    Image.new("RGB", size, color).save(out, format="PNG", pnginfo=meta)
    return out.getvalue()


class FakeProvider:
    name = "Fake"

    def __init__(self):
        self.ready = True
        self.calls: list[ImageRequest] = []
        self.behavior = "ok"

    async def status(self):
        return ImageProviderStatus(provider="Fake", ready=self.ready, detail="" if self.ready else "Server down")

    async def generate(self, request, progress):
        self.calls.append(request)
        for step in (1, 2):
            await progress(ImageProgress(stage="running", step=step, total=2))
        if self.behavior == "error":
            raise ImageGenerationError("The GPU ran out of memory; choose a smaller model")
        if self.behavior == "crash":
            raise RuntimeError("segfault")
        if self.behavior == "slow":
            await asyncio.sleep(5)
        data = b"not an image" if self.behavior == "garbage" else png()
        seed = request.seed if request.seed is not None else 42
        return ProviderResult(
            images=[ProviderImage(png=data, seed=seed + n, width=32, height=24) for n in range(request.count)],
            model="fake/model",
            revision="r1",
            steps=2,
        )


@component_registry.register()
class FakeGenerator(ImageGeneratorComponent[NoArgs]):
    """An image generator component delegating to the test's FakeProvider."""

    name = "Fake"
    parameters = NoArgs
    current: FakeProvider = FakeProvider()

    async def status(self):
        return await FakeGenerator.current.status()

    async def __call__(self, request, progress):
        return await FakeGenerator.current.generate(request, progress)


@pytest.fixture
def images(canvas_api, monkeypatch, tmp_path):
    from asterism.domains.files.store import LocalFileStore

    store = LocalFileStore(tmp_path / "files")
    for module in ("files.service", "files.produced"):
        monkeypatch.setattr(f"asterism.domains.{module}.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)
    monkeypatch.setattr("asterism.domains.files.produced.start_ingestion", lambda **_: None)
    import asterism.db.database as database

    # produced.py keeps its own reference to the session factory.
    monkeypatch.setattr("asterism.domains.files.produced.get_async_db_session", database.get_async_db_session)
    provider = FakeGenerator.current = FakeProvider()
    client, sessions = canvas_api
    return client, sessions, provider


async def set_policy(sessions, *, enabled=True, provider="Fake", group_ids=None, tools=True, parameters=None):
    """The policy plus the selected generator component (None: no generator)."""
    keys = ("image_generation", "image_generator_provider")
    async with sessions() as db:
        await db.execute(delete(ApplicationSettingsModel).where(ApplicationSettingsModel.key.in_(keys)))
        db.add(ApplicationSettingsModel(key="image_generation", value={"enabled": enabled, "group_ids": group_ids}))
        if provider is not None:
            db.add(
                ApplicationSettingsModel(
                    key="image_generator_provider", value={"name": provider, "parameters": parameters or {}}
                )
            )
        await db.execute(update(LLMModel).values(supports_tools=tools))
        await db.commit()


async def records(sessions):
    async with sessions() as db:
        return list(await db.scalars(select(ImageGenerationModel).order_by(ImageGenerationModel.created_at)))


async def test_prompts_pairing_minors_with_sexual_content_are_refused():
    for refused in (
        "a nude teenager",
        "Sexy schoolgirl in a classroom",
        "15 year old in lingerie",
        "loli character",
        "naked child at the beach",
    ):
        assert refusal_reason(refused), refused
    for allowed in (
        "a child flying a kite at the beach",
        "a nude figure study in charcoal, adult model",
        "teenagers playing basketball",
        "a sexy sports car",
    ):
        assert refusal_reason(allowed) is None, allowed
    # The negative prompt counts too.
    assert refusal_reason("portrait of a girl", "nude") is None
    assert refusal_reason("portrait of a little girl", "") is None
    assert refusal_reason("little girl", "naked")


def test_the_prompt_check_sees_through_accents_and_invisible_characters():
    """US-116.3: spellings that look the same to a person match the same words."""
    for disguised in (
        "a ch\u00efld, n\u00fcde",  # accents
        "a chi\u200bld, nu\u200dde",  # zero-width space and joiner inside the words
        "a chi\u00adld, nu\u2060de",  # soft hyphen and word joiner
        "a \uff43\uff48\uff49\uff4c\uff44, \uff4e\uff55\uff44\uff45",  # full-width letters
        "a CHILD, NUDE",
        "a child\u202e, nude",  # a direction mark
    ):
        assert refusal_reason(disguised), ascii(disguised)
    assert refusal_reason("a caf\u00e9 with a child reading") is None


async def test_policy_endpoints_and_availability(images):
    client, sessions, provider = images
    assert (await client.get("/settings/app/image-generation", headers=auth("a"))).status_code == 403
    assert (await client.get("/settings/app/image-generation", headers=auth("admin"))).json() == {
        "enabled": False,
        "group_ids": None,
    }
    available = await client.get("/image-generation/availability", headers=auth())
    assert available.json() == {"available": False, "reason": "Image generation is turned off"}

    saved = await client.put("/settings/app/image-generation", headers=auth("admin"), json={"enabled": True})
    assert saved.status_code == 200, saved.text
    status = await client.get("/settings/app/image-generation/status", headers=auth("admin"))
    assert status.json() == {"provider": "none", "ready": False, "detail": "No image provider is set up"}
    # The generator is a component setting, chosen like the search providers.
    chosen = await client.put(
        "/settings/app/image_generator_provider", headers=auth("admin"), json={"value": {"name": "Fake"}}
    )
    assert chosen.status_code == 200, chosen.text
    unknown = await client.put(
        "/settings/app/image_generator_provider", headers=auth("admin"), json={"value": {"name": "Nope"}}
    )
    assert unknown.status_code == 400 and "Unknown provider" in unknown.text
    status = await client.get("/settings/app/image-generation/status", headers=auth("admin"))
    assert status.json() == {"provider": "Fake", "ready": True, "detail": ""}
    assert (await client.get("/image-generation/availability", headers=auth())).json()["available"] is True

    provider.ready = False
    assert (await client.get("/image-generation/availability", headers=auth())).json() == {
        "available": False,
        "reason": "Server down",
    }
    provider.ready = True

    # Group limits: unknown groups are refused; a user outside the list can't generate.
    bad = await client.put(
        "/settings/app/image-generation",
        headers=auth("admin"),
        json={"enabled": True, "group_ids": ["nope"]},
    )
    assert bad.status_code == 400
    limited = await client.put(
        "/settings/app/image-generation",
        headers=auth("admin"),
        json={"enabled": True, "group_ids": ["educator"]},
    )
    assert limited.status_code == 200, limited.text
    assert (await client.get("/image-generation/availability", headers=auth())).json() == {
        "available": False,
        "reason": "Image generation isn't available to your group",
    }
    # An unconfigured provider is never ready, and malformed policy writes are refused.
    await set_policy(sessions, provider="Diffusers")
    assert (await client.get("/image-generation/availability", headers=auth())).json()["available"] is False
    assert (
        await client.put("/settings/app/image-generation", headers=auth("admin"), json={"enabled": "yes"})
    ).status_code == 422


async def test_an_admin_can_test_the_generator_before_turning_it_on(images):
    client, sessions, provider = images
    url = "/settings/app/image-generation/test"
    await set_policy(sessions, enabled=False, provider=None)
    assert (await client.post(url, headers=auth("a"), json={"prompt": "A heron"})).status_code == 403
    none = await client.post(url, headers=auth("admin"), json={"prompt": "A heron"})
    assert none.status_code == 400 and "No image provider is set up" in none.text

    # The policy is off for users, but the admin's test still runs and saves to their files.
    await set_policy(sessions, enabled=False)
    assert (await client.get("/image-generation/availability", headers=auth("admin"))).json()["available"] is False
    made = await client.post(url, headers=auth("admin"), json={"prompt": "A heron at dawn"})
    assert made.status_code == 200, made.text
    image = made.json()
    assert image["model"] == "fake/model" and image["prompt"] == "A heron at dawn"
    async with sessions() as db:
        file = await db.get(UserFileModel, uuid.UUID(image["file_id"]))
    assert file.user_id == "admin" and file.filename == image["filename"]
    assert provider.calls[-1].count == 1 and provider.calls[-1].width == 1024

    # Readiness, the prompt check and the audit record still apply.
    provider.ready = False
    down = await client.post(url, headers=auth("admin"), json={"prompt": "A heron"})
    assert down.status_code == 400 and "Server down" in down.text
    provider.ready = True
    refused = await client.post(url, headers=auth("admin"), json={"prompt": "naked child"})
    assert refused.status_code == 400
    assert [(row.user_id, row.status) for row in await records(sessions)] == [
        ("admin", "completed"),
        ("admin", "refused"),
    ]


async def test_the_tool_is_offered_to_the_main_agent_only_when_available(images):
    client, sessions, provider = images
    chat_id, _, _ = await started_chat(client, sessions)
    main = await get_main_agent_profile("a")

    async def tools():
        return (await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=main, model_id=uuid.UUID(A)))[0]

    await set_policy(sessions, enabled=False)
    assert "generate_image" not in await tools()
    await set_policy(sessions)
    assert "generate_image" in await tools()
    provider.ready = False
    assert "generate_image" not in await tools()
    provider.ready = True
    await set_policy(sessions, tools=False)
    assert await tools() == []

    # Each call rechecks the policy; sub-agents never get it.
    await set_policy(sessions)
    _, scope = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=main, model_id=uuid.UUID(A))
    await require_internal_tool(name="generate_image", user_id="a", chat_id=chat_id, scope=scope)
    await set_policy(sessions, enabled=False)
    with pytest.raises(BadDataException):
        await require_internal_tool(name="generate_image", user_id="a", chat_id=chat_id, scope=scope)
    await set_policy(sessions)
    helper = await get_agent_profile("a", uuid.UUID((await worker(client, "Helper"))["id"]))
    from dataclasses import replace

    with pytest.raises(BadDataException):
        await require_internal_tool(
            name="generate_image",
            user_id="a",
            chat_id=chat_id,
            scope=replace(scope, caller_agent_id=helper.id, model_id=helper.model_id),
        )
    assert tool_registry["generate_image"].policy == ToolPolicy.CONTEXT_MANAGED
    assert configurable_tools(["generate_image", "web_search"]) == ["web_search"]
    assert (
        await client.put("/settings/user/main-agent", headers=auth(), json={"tools": ["generate_image"]})
    ).status_code == 400


async def test_generating_saves_chat_files_streams_progress_and_records(images):
    client, sessions, provider = images
    chat_id, request, run = await started_chat(client, sessions)
    await set_policy(sessions)
    events: list[ToolProgress] = []

    async def sink(progress):
        events.append(progress)

    ctx = tool_ctx(chat_id, scope_for(chat_id, request, run), GenerateImageArgs(prompt="A lighthouse at dusk", count=2))
    from dataclasses import replace

    ctx = replace(ctx, progress_sink=sink, tool_call_id="call-1")
    result = await generate_image(ctx)
    assert "error" not in result, result
    [first, second] = result["images"]
    assert (first["width"], first["height"], first["seed"], second["seed"]) == (32, 24, 42, 43)
    assert first["filename"] == "a-lighthouse-at-dusk-42.png" and first["model"] == "fake/model"
    assert result["show_in_reply"].endswith(f"{first['embed']} {second['embed']}")
    assert first["embed"] == f"![a-lighthouse-at-dusk-42.png](asterism-file:{first['file_id']})"
    assert provider.calls[0].width == 1024 and provider.calls[0].count == 2
    assert [(event.stage, event.step) for event in events] == [
        ("queued", None),
        ("running", 0),
        ("running", 1),
        ("running", 2),
        ("saving", None),
    ]
    assert {event.tool_call_id for event in events} == {"call-1"}

    async with sessions() as db:
        saved = await db.get(UserFileModel, uuid.UUID(first["file_id"]))
        assert saved is not None and saved.user_id == "a" and saved.mime_type == "image/png"
        assert (saved.origin, saved.produced_tool, saved.produced_execution_id) == (
            FileOrigin.AGENT,
            "generate_image",
            run,
        )
        # Joined to the chat on its run's branch.
        member = await db.scalar(
            select(ChatFileModel).where(ChatFileModel.chat_id == chat_id, ChatFileModel.file_id == saved.id)
        )
        assert member is not None
    # Re-encoded: provider metadata (e.g. a ComfyUI workflow) is dropped.
    from asterism.domains.files import produced

    data = produced.get_file_store().local_path("a", saved.storage_key).read_bytes()
    assert data.startswith(b"\x89PNG") and b"workflow" not in data
    [record] = await records(sessions)
    assert (record.status, record.prompt, record.model, record.revision, record.steps) == (
        "completed",
        "A lighthouse at dusk",
        "fake/model",
        "r1",
        2,
    )
    assert [image["seed"] for image in record.images] == [42, 43] and record.chat_id == chat_id

    # Outside a main-agent run the tool refuses.
    refused = await generate_image(
        tool_ctx(chat_id, scope_for(chat_id, request, run, sub_agent=True), GenerateImageArgs(prompt="x"))
    )
    assert "error" in refused


async def test_failures_refusals_and_cancellation_are_recorded(images):
    client, sessions, provider = images
    chat_id, request, run = await started_chat(client, sessions)
    await set_policy(sessions)
    scope = scope_for(chat_id, request, run)

    async def call(prompt="A red fox", **args):
        return await generate_image(tool_ctx(chat_id, scope, GenerateImageArgs(prompt=prompt, **args)))

    refused = await call("a nude teenager")
    assert "minor" in refused["error"] and provider.calls == []
    provider.behavior = "error"
    assert (await call())["error"] == "The GPU ran out of memory; choose a smaller model"
    provider.behavior = "crash"
    # Internal errors are not shown to the user.
    assert (await call())["error"] == "Image generation failed; try again or ask an administrator"
    provider.behavior = "garbage"
    assert (await call())["error"] == "The image provider returned something that isn't an image"
    provider.behavior = "slow"
    with pytest.raises(BadDataException, match="timed out"):
        await generate_images(user_id="a", chat_id=chat_id, request=ImageRequest(prompt="x"), timeout=0.05)
    task = asyncio.create_task(generate_images(user_id="a", chat_id=chat_id, request=ImageRequest(prompt="y")))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await set_policy(sessions, enabled=False)
    provider.behavior = "ok"
    assert (await call())["error"] == "Image generation is turned off"

    statuses = [(record.status, record.error[:30]) for record in await records(sessions)]
    assert [status for status, _ in statuses] == ["refused", "failed", "failed", "failed", "failed", "cancelled"]
    assert statuses[2][1].startswith("RuntimeError")


async def test_create_image_turns_are_checked_and_recorded(images):
    client, sessions, provider = images
    chat_id, request, run = await started_chat(client, sessions)
    await finish(sessions, chat_id, request, run)
    chat = (await client.get(f"/chat/{chat_id}", headers=auth())).json()

    def send(**extra):
        return client.post(
            f"/chat/{chat_id}/message",
            headers=auth(),
            json={
                "request_id": str(uuid.uuid4()),
                "user_prompt": "A cat in a spacesuit",
                "parent_message_id": chat["messages"][-1]["id"],
                "expected_model_revision": chat["info"]["model_revision"],
                **extra,
            },
        )

    await set_policy(sessions, enabled=False)
    off = await send(create_image=True)
    assert off.status_code == 400 and "turned off" in off.text
    await set_policy(sessions)
    accepted = await send(create_image=True)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["image_request"] is True
    async with sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(purpose="skill_draft"))
        await db.commit()
    # Drafting chats are refused before Create image is even considered.
    assert (await send(create_image=True)).status_code in (400, 403)


class ScriptedClient:
    """An LLM client that records each request and answers from a script."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.requests: list[dict] = []

    async def chat(self, messages, tools=None, **params):
        self.requests.append({"tools": tools, **params})
        step = self.steps.pop(0)
        yield LLMEvent(type=LLMEventType.COMPLETE, content=step.get("content", ""), tool_calls=step.get("tool_calls"))


async def run_agent(sessions, chat_id, client, *, image_request=True, scope=None):
    async with sessions() as db:
        opened = await get_one(chat_id, "a", db)
        profile = await get_main_agent_profile("a", db)
    agent = Agent(
        profile=profile,
        user=AuthedUser(id="a", name="a", email="a@x.test", role="user"),
        session=opened,
        model_id=uuid.UUID(A),
    )
    agent.image_request = image_request
    agent._get_client = AsyncMock(return_value=client)  # type: ignore[method-assign]
    if scope is not None:
        agent.execution_scope = scope
    return agent, [event async for event in agent.run(messages=[LLMMessage.user("A cat in a spacesuit")])]


async def test_create_image_forces_the_tool_or_generates_directly(images, monkeypatch):
    client, sessions, provider = images
    chat_id, request, run = await started_chat(client, sessions)
    await set_policy(sessions)
    call = ToolCall(id="c1", function=Function(name="generate_image", arguments=json.dumps({"prompt": "A cat"})))
    scripted = ScriptedClient({"tool_calls": [call]}, {"content": "Here it is."})
    _, events = await run_agent(sessions, chat_id, scripted, scope=scope_for(chat_id, request, run))
    results = [event.tool_results for event in events if event.type == AgentEventType.COMPLETE]
    assert results[0] and "error" not in results[0][0].content, results
    assert scripted.requests[0]["tool_choice"] == {"type": "function", "function": {"name": "generate_image"}}
    # Only the first step is forced.
    assert "tool_choice" not in scripted.requests[1]
    assert any(event.type == AgentEventType.TOOL_PROGRESS for event in events)

    # Without tool support the message text goes straight to the generator.
    await set_policy(sessions, tools=False)
    direct = ScriptedClient()
    agent, events = await run_agent(sessions, chat_id, direct, scope=scope_for(chat_id, request, run))
    assert direct.requests == []
    complete = [event for event in events if event.type == AgentEventType.COMPLETE]
    assert len(complete) == 1 and complete[0].content.startswith("Here's the image you asked for.")
    assert "](asterism-file:" in complete[0].content
    assert provider.calls[-1].prompt == "A cat in a spacesuit"

    # Turned off after sending: a clear error, nothing generated.
    await set_policy(sessions, enabled=False, tools=False)
    count = len(provider.calls)
    _, events = await run_agent(sessions, chat_id, ScriptedClient(), scope=scope_for(chat_id, request, run))
    assert [event.content for event in events if event.type == AgentEventType.ERROR] == [
        "Image generation is turned off"
    ]
    assert len(provider.calls) == count


async def test_images_are_counted_as_usage_and_refused_over_budget(images, monkeypatch):
    """US-86.3: images use no tokens, but each saved image is counted and a user over budget gets none."""
    import asterism.db.database as database
    from asterism.domains.groups.models import GroupModel
    from asterism.domains.usage.models import UsageRecordModel
    from asterism.domains.usage.service import UsageLimitExceeded

    monkeypatch.setattr("asterism.domains.usage.service.get_async_db_session", database.get_async_db_session)
    client, sessions, _ = images
    chat_id, _, _ = await started_chat(client, sessions)
    await set_policy(sessions)
    await generate_images(user_id="a", chat_id=chat_id, request=ImageRequest(prompt="A harbour", count=2))
    async with sessions() as db:
        [usage] = list(await db.scalars(select(UsageRecordModel)))
        assert (usage.source, usage.images, usage.input_tokens, usage.chat_id) == ("image", 2, 0, chat_id)
        db.add(UsageRecordModel(user_id="a", source="chat", input_tokens=50, output_tokens=0))
        await db.execute(update(GroupModel).where(GroupModel.id == "student").values(daily_token_budget=50))
        await db.commit()
    with pytest.raises(UsageLimitExceeded):
        await generate_images(user_id="a", chat_id=chat_id, request=ImageRequest(prompt="Another harbour"))


async def test_generated_images_are_cleaned_outside_the_event_loop(images, monkeypatch):
    import threading

    from asterism.domains.image_generation import service

    client, sessions, _ = images
    await set_policy(sessions)
    loop_thread, cleaned_on = threading.get_ident(), []
    real = service._clean_png

    def clean(image):
        cleaned_on.append(threading.get_ident())
        return real(image)

    monkeypatch.setattr(service, "_clean_png", clean)
    made = await client.post("/settings/app/image-generation/test", headers=auth("admin"), json={"prompt": "A heron"})

    assert made.status_code == 200, made.text
    assert cleaned_on and loop_thread not in cleaned_on
