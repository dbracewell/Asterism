"""US-72.1: canvas items are versioned, branch-aware and gated by two switches (ADR-0063)."""

import json
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.domains.agent.execution_scope import ExecutionScope, ModelIdentity
from asterism.domains.agent.service import get_agent_profile, get_main_agent_profile
from asterism.domains.canvas.branches import active_branch, run_branch
from asterism.domains.canvas.models import CanvasItemModel, CanvasVersionModel
from asterism.domains.canvas.schemas import MAX_CONTENT_BYTES
from asterism.domains.canvas.service import Anchor, add_version, apply_edits, create_item, visible_items
from asterism.domains.chat.execution import prepare_execution
from asterism.domains.chat.models import ChatModel, MessageModel
from asterism.domains.chat.prompt_composition import build_runtime_prompt
from asterism.domains.chat.schemas import Chat, ChatInfo, MessageStatus
from asterism.domains.chat.tool_policy import require_internal_tool, resolve_effective_tools
from asterism.domains.llm.schemas import Function, ToolCall
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel, UserSettingModel
from asterism.domains.tools.builtin.canvas import (
    CanvasCreateArgs,
    CanvasReadArgs,
    CanvasUpdateArgs,
    canvas_create,
    canvas_read,
    canvas_update,
)
from asterism.domains.tools.catalog import CANVAS_TOOL_NAMES, ToolPolicy, configurable_tools
from asterism.domains.tools.registry import ToolContext, tool_registry
from pydantic import ValidationError
from sqlalchemy import delete, func, select, update
from test_chat_models import A, new_chat
from test_project_sub_agents import worker
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
project_api = _project_api
CANVAS = sorted(CANVAS_TOOL_NAMES)


@pytest.fixture
def canvas_api(project_api, monkeypatch):
    client, sessions, _ = project_api

    def token(value):
        return AuthedUser(
            id=value, email=f"{value}@example.test", name=value, role="admin" if value == "admin" else "user"
        )

    monkeypatch.setattr("asterism.core.security.verify_jwks_token", token)

    @asynccontextmanager
    async def session_context(session=None):
        if session is not None:
            yield session
        else:
            async with sessions() as db:
                yield db

    # The tools open their own sessions for every live check.
    monkeypatch.setattr("asterism.db.database.get_async_db_session", session_context)
    return client, sessions


async def switches(sessions, *, admin=True, user=True, owner="a"):
    async with sessions() as db:
        for model, key, values in [
            (ApplicationSettingsModel, {"key": "canvas_enabled"}, admin),
            (UserSettingModel, {"key": "canvas_enabled", "user_id": owner}, user),
        ]:
            await db.execute(delete(model).filter_by(**key))
            db.add(model(**key, value=values))
        await db.execute(update(LLMModel).values(supports_tools=True))
        await db.commit()


async def started_chat(client, sessions):
    """A chat whose first turn has a run in progress."""
    chat = await new_chat(client)
    chat_id, request = uuid.UUID(chat["info"]["id"]), uuid.UUID(chat["messages"][0]["id"])
    async with sessions() as db:
        execution = await prepare_execution(user_id="a", chat_id=chat_id, message_id=request, session=db)
    return chat_id, request, execution.id


async def finish(sessions, chat_id, request, execution_id):
    """Persist the run's reply on the active branch, as the orchestrator does."""
    async with sessions() as db:
        reply = MessageModel(
            user_id="a",
            chat_id=chat_id,
            role="assistant",
            content="Done",
            status=MessageStatus.COMPLETED,
            parent_message_id=request,
            execution_id=execution_id,
        )
        db.add(reply)
        await db.flush()
        await db.execute(
            update(MessageModel)
            .where(MessageModel.id == request)
            .values(active_child_id=reply.id, pending_execution_id=None, status=MessageStatus.COMPLETED)
        )
        await db.commit()
        return reply.id


def agent(request, execution_id):
    return Anchor(author="agent", message_id=request, execution_id=execution_id)


async def titles(sessions, chat_id, branch_of):
    async with sessions() as db:
        branch = await branch_of(db)
        return [entry.current.title for entry in await visible_items("a", chat_id, branch, db)]


async def test_versions_follow_the_branch_they_were_written_on(canvas_api):
    client, sessions = canvas_api
    chat_id, request, first_run = await started_chat(client, sessions)
    async with sessions() as db:
        branch = await run_branch("a", chat_id, request, first_run, db)
        item = await create_item(
            "a",
            chat_id,
            branch,
            agent(request, first_run),
            kind="document",
            title="Plan",
            content="# Plan\nStep one.",
            language=None,
            session=db,
        )
        # Later calls in the same run see it, before any reply is saved.
        assert [entry.item.id for entry in await visible_items("a", chat_id, branch, db)] == [item.item.id]

    def active(db):
        return active_branch("a", chat_id, db)

    # The user sees it while the run is in progress and after it finishes.
    assert await titles(sessions, chat_id, active) == ["Plan"]
    await finish(sessions, chat_id, request, first_run)
    assert await titles(sessions, chat_id, active) == ["Plan"]

    # Regenerating the turn hides what the replaced run wrote.
    async with sessions() as db:
        second_run = (
            await prepare_execution(user_id="a", chat_id=chat_id, message_id=request, restart=True, session=db)
        ).id
        await db.execute(update(MessageModel).where(MessageModel.id == request).values(active_child_id=None))
        await db.commit()
    assert await titles(sessions, chat_id, active) == []
    async with sessions() as db:
        regenerated = await run_branch("a", chat_id, request, second_run, db)
        with pytest.raises(NotFoundException):
            await add_version(
                "a", chat_id, item.item.id, regenerated, agent(request, second_run), title="X", session=db
            )
        await create_item(
            "a",
            chat_id,
            regenerated,
            agent(request, second_run),
            kind="code",
            title="Script",
            content="print(1)",
            language="Python",
            session=db,
        )
    reply = await finish(sessions, chat_id, request, second_run)
    assert await titles(sessions, chat_id, active) == ["Script"]

    # Switching back to the first reply shows the first run's work again.
    async with sessions() as db:
        first_reply = await db.scalar(select(MessageModel.id).where(MessageModel.execution_id == first_run))
        await db.execute(update(MessageModel).where(MessageModel.id == request).values(active_child_id=first_reply))
        await db.commit()
    assert await titles(sessions, chat_id, active) == ["Plan"]

    # A user's edit is anchored to the leaf and has no run.
    async with sessions() as db:
        branch = await active_branch("a", chat_id, db)
        edited = await add_version(
            "a",
            chat_id,
            item.item.id,
            branch,
            Anchor(author="user", message_id=first_reply, execution_id=None),
            title=None,
            content="# Plan\nMy own step.",
            session=db,
        )
        assert (edited.current.number, edited.current.author) == (2, "user")
        with pytest.raises(BadDataException):
            await add_version(
                "a",
                chat_id,
                item.item.id,
                branch,
                Anchor(author="user", message_id=reply, execution_id=None),
                title="Off-branch anchor",
                session=db,
            )

    # Deleting the chat deletes its canvas.
    async with sessions() as db:
        await db.execute(delete(ChatModel).where(ChatModel.id == chat_id))
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(CanvasItemModel)) == 0
        assert await db.scalar(select(func.count()).select_from(CanvasVersionModel)) == 0


async def test_deleting_the_anchor_message_deletes_its_versions(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    async with sessions() as db:
        branch = await run_branch("a", chat_id, request, run, db)
        await create_item(
            "a",
            chat_id,
            branch,
            agent(request, run),
            kind="html",
            title="Page",
            content="<p>Hi</p>",
            language="x",
            session=db,
        )
        await db.execute(delete(MessageModel).where(MessageModel.id == request))
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(CanvasVersionModel)) == 0


async def test_targeted_edits_need_one_exact_match():
    assert apply_edits("a b c", [("b", "B"), ("c", "C")]) == "a B C"
    for edits, message in [
        ([("x", "y")], "was not found"),
        ([("a", "y")], "occurs 2 times"),
        ([("", "y")], "is empty"),
        ([], "Give 1"),
    ]:
        with pytest.raises(BadDataException, match=message):
            apply_edits("a b a", edits)


async def test_limits_and_validation(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    async with sessions() as db:
        branch = await run_branch("a", chat_id, request, run, db)

        async def make(**kwargs):
            values = {"kind": "document", "title": "Notes", "content": "x", "language": None} | kwargs
            return await create_item("a", chat_id, branch, agent(request, run), session=db, **values)

        for kwargs, message in [
            ({"kind": "code", "language": None}, "needs a language"),
            ({"kind": "code", "language": "no spaces"}, "needs a language"),
            ({"title": "   "}, "title"),
            ({"content": "é" * (MAX_CONTENT_BYTES // 2 + 1)}, "limited"),
        ]:
            with pytest.raises(BadDataException, match=message):
                await make(**kwargs)
            await db.rollback()
        made = await make(kind="code", language="TypeScript")
        assert made.item.language == "typescript"
        # Only code keeps a language.
        assert (await make(language="python")).item.language == ""
        with pytest.raises(BadDataException):
            await create_item(
                "a",
                chat_id,
                branch,
                Anchor(author="agent", message_id=request, execution_id=None),
                kind="document",
                title="T",
                content="x",
                language=None,
                session=db,
            )
        with pytest.raises(BadDataException, match="either"):
            await add_version(
                "a",
                chat_id,
                made.item.id,
                branch,
                agent(request, run),
                title=None,
                content="x",
                edits=[("x", "y")],
                session=db,
            )


async def test_tools_are_offered_to_the_main_agent_only_when_both_switches_are_on(canvas_api):
    client, sessions = canvas_api
    chat_id, _, _ = await started_chat(client, sessions)
    main = await get_main_agent_profile("a")

    async def tools(profile=main, model=uuid.UUID(A)):
        return (await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=profile, model_id=model))[0]

    await switches(sessions, admin=False, user=True)
    assert not set(CANVAS) & set(await tools())
    await switches(sessions, admin=True, user=False)
    assert not set(CANVAS) & set(await tools())
    await switches(sessions)
    assert set(CANVAS) <= set(await tools())
    # The Tools allowlist plays no part.
    async with sessions() as db:
        active = await db.get(ApplicationSettingsModel, "active_tools")
        assert active is None or not set(CANVAS) & set(active.value)

    # Each call rechecks both switches.
    _, scope = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=main, model_id=uuid.UUID(A))
    for name in CANVAS:
        await require_internal_tool(name=name, user_id="a", chat_id=chat_id, scope=scope)
    await switches(sessions, user=False)
    with pytest.raises(BadDataException):
        await require_internal_tool(name="canvas_create", user_id="a", chat_id=chat_id, scope=scope)
    await switches(sessions)

    # No tool support, no canvas.
    async with sessions() as db:
        await db.execute(update(LLMModel).values(supports_tools=False))
        await db.commit()
    assert await tools() == []
    await switches(sessions)

    # Skill-drafting chats never get the canvas.
    async with sessions() as db:
        await db.execute(update(ChatModel).where(ChatModel.id == chat_id).values(purpose="skill_draft"))
        await db.commit()
    assert not set(CANVAS) & set(await tools())


async def test_sub_agents_do_not_get_canvas_tools(canvas_api):
    client, sessions = canvas_api
    chat_id, _, _ = await started_chat(client, sessions)
    await switches(sessions)
    helper = await worker(client, "Helper")
    profile = await get_agent_profile("a", uuid.UUID(helper["id"]))
    _, ceiling = await resolve_effective_tools(
        user_id="a", chat_id=chat_id, profile=await get_main_agent_profile("a"), model_id=uuid.UUID(A)
    )
    from dataclasses import replace

    child_scope = replace(ceiling, caller_agent_id=profile.id, model_id=profile.model_id)
    with pytest.raises(BadDataException):
        await require_internal_tool(name="canvas_read", user_id="a", chat_id=chat_id, scope=child_scope)


async def test_canvas_tools_are_not_user_configurable(canvas_api):
    client, _ = canvas_api
    for name in CANVAS:
        assert tool_registry[name].policy == ToolPolicy.CONTEXT_MANAGED
    assert not set(CANVAS) & {tool.name for tool in tool_registry.tools().items}
    assert configurable_tools([*CANVAS, "web_search"]) == ["web_search"]
    assert (
        await client.put("/settings/user/main-agent", headers=auth(), json={"tools": ["canvas_create"]})
    ).status_code == 400


def scope_for(chat_id, request, run, *, user="a", sub_agent=False):
    return ExecutionScope(
        user_id=user,
        agent_id=uuid.uuid4(),
        is_sub_agent=sub_agent,
        chat_id=chat_id,
        project_id=None,
        selected_model=None,
        executed_model=ModelIdentity(id=uuid.UUID(A)),
        eligible_sub_agent_ids=frozenset(),
        effective_internal_tools=frozenset(),
        active_branch_message_ids=(),
        configuration_revision=1,
        prompt_revision=None,
        allowed_file_ids=frozenset(),
        file_provenance=(),
        request_message_id=request,
        execution_id=run,
    )


def tool_ctx(chat_id, scope, args, user="a"):
    return ToolContext(
        args=args,
        user=AuthedUser(id=user, email=f"{user}@x.test", name=user, role="user"),
        user_message="",
        session=Chat(info=ChatInfo(id=chat_id, user_id=user, created_at=0, updated_at=0), messages=[]),
        app_settings=MagicMock(),
        client=MagicMock(),
        execution_scope=scope,
    )


async def test_tools_create_update_and_read_on_the_run_branch(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    scope = scope_for(chat_id, request, run)

    created = await canvas_create(
        tool_ctx(chat_id, scope, CanvasCreateArgs(kind="document", title="Essay", content="Intro. Body. End."))
    )
    assert set(created) == {"item_id", "version", "kind", "language", "title"}
    assert "Intro" not in json.dumps(created)
    item_id = created["item_id"]

    updated = await canvas_update(
        tool_ctx(
            chat_id,
            scope,
            CanvasUpdateArgs(item_id=item_id, edits=[{"find": "Body.", "replace": "Better body."}], title="Essay v2"),
        )
    )
    assert updated == {"item_id": item_id, "version": 2, "title": "Essay v2"}
    read = await canvas_read(tool_ctx(chat_id, scope, CanvasReadArgs(item_id=item_id)))
    assert (read["content"], read["version"], read["author"]) == ("Intro. Better body. End.", 2, "agent")
    listed = await canvas_read(tool_ctx(chat_id, scope, CanvasReadArgs()))
    assert [(item["id"], item["version"]) for item in listed["items"]] == [(item_id, 2)]

    with pytest.raises(BadDataException, match="was not found"):
        await canvas_update(
            tool_ctx(chat_id, scope, CanvasUpdateArgs(item_id=item_id, edits=[{"find": "Missing", "replace": "x"}]))
        )
    with pytest.raises(BadDataException):
        await canvas_read(tool_ctx(chat_id, scope, CanvasReadArgs(item_id="not-an-id")))
    with pytest.raises(ValidationError):
        CanvasUpdateArgs(item_id=item_id, content="x", edits=[{"find": "a", "replace": "b"}])
    with pytest.raises(ValidationError):
        CanvasUpdateArgs(item_id=item_id)

    # Without a recorded main-agent run, or for another user, the tools refuse.
    for bad in [None, scope_for(chat_id, request, run, sub_agent=True), scope_for(chat_id, None, run)]:
        with pytest.raises(BadDataException):
            await canvas_read(tool_ctx(chat_id, bad, CanvasReadArgs()))
    with pytest.raises(BadDataException):
        await canvas_read(tool_ctx(chat_id, scope_for(chat_id, request, run, user="b"), CanvasReadArgs(), user="b"))

    # Switching canvas off stops the tools mid-run.
    await switches(sessions, admin=False)
    with pytest.raises(BadDataException, match="turned off"):
        await canvas_read(tool_ctx(chat_id, scope, CanvasReadArgs()))


async def test_invoking_a_canvas_tool_needs_its_policy_not_the_tools_allowlist(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    main = await get_main_agent_profile("a")
    _, ceiling = await resolve_effective_tools(user_id="a", chat_id=chat_id, profile=main, model_id=uuid.UUID(A))

    async def authorize(name):
        await require_internal_tool(name=name, user_id="a", chat_id=chat_id, scope=ceiling)

    result = await tool_registry.invoke_tool(
        tool_call=ToolCall(
            id="c1",
            function=Function(
                name="canvas_create", arguments='{"kind": "document", "title": "Notes", "content": "Hello"}'
            ),
        ),
        user=AuthedUser(id="a", email="a@x.test", name="a", role="user"),
        client=MagicMock(),
        session=Chat(info=ChatInfo(id=chat_id, user_id="a", created_at=0, updated_at=0), messages=[]),
        app_settings=SimpleNamespace(active_tools=[]),
        max_retries=0,
        tool_scope=ceiling,
        execution_scope=scope_for(chat_id, request, run),
        authorize_internal=authorize,
    )
    assert json.loads(result.content)["version"] == 1


async def test_runtime_prompt_lists_the_visible_items(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    await canvas_create(
        tool_ctx(
            chat_id,
            scope_for(chat_id, request, run),
            CanvasCreateArgs(kind="code", title="Parser", content="def parse(): ...", language="python"),
        )
    )
    main = await get_main_agent_profile("a")
    async with sessions() as db:
        text = await build_runtime_prompt(
            user_id="a", chat_id=chat_id, profile=main, tools=CANVAS, scope=None, session=db
        )
        without = await build_runtime_prompt(
            user_id="a", chat_id=chat_id, profile=main, tools=[], scope=None, session=db
        )
    assert "canvas_create" in text and "(code, python, version 1): Parser" in text
    assert "def parse" not in text
    assert "Canvas" not in without


async def test_reading_api_is_owner_scoped_and_follows_the_active_branch(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    created = await canvas_create(
        tool_ctx(
            chat_id, scope_for(chat_id, request, run), CanvasCreateArgs(kind="html", title="Page", content="<p>1</p>")
        )
    )
    await canvas_update(
        tool_ctx(
            chat_id, scope_for(chat_id, request, run), CanvasUpdateArgs(item_id=created["item_id"], content="<p>2</p>")
        )
    )
    base = f"/chat/{chat_id}/canvas"
    listed = (await client.get(base, headers=auth())).json()
    assert [(item["title"], item["version"], item["kind"]) for item in listed] == [("Page", 2, "html")]
    history = (await client.get(f"{base}/{created['item_id']}", headers=auth())).json()
    assert [version["number"] for version in history["versions"]] == [1, 2]
    first = (await client.get(f"{base}/{created['item_id']}/versions/1", headers=auth())).json()
    assert first["content"] == "<p>1</p>" and first["author"] == "agent"
    assert (await client.get(f"{base}/{created['item_id']}/versions/9", headers=auth())).status_code == 404
    # Another user sees nothing, not even that the chat exists.
    assert (await client.get(base, headers=auth("b"))).status_code == 404
    assert (await client.get(f"{base}/{created['item_id']}", headers=auth("b"))).status_code == 404
    # Reading still works with canvas switched off.
    await switches(sessions, admin=False, user=False)
    assert (await client.get(base, headers=auth())).status_code == 200


async def test_policy_endpoints_and_user_setting(canvas_api):
    client, _ = canvas_api
    assert (await client.get("/settings/app/canvas", headers=auth("a"))).status_code == 401
    assert (await client.get("/settings/app/canvas", headers=auth("admin"))).json() == {"enabled": False}
    assert (await client.put("/settings/app/canvas", headers=auth("admin"), json={"enabled": "yes"})).status_code == 422
    assert (await client.put("/settings/app/canvas", headers=auth("admin"), json={"enabled": True})).json() == {
        "enabled": True
    }
    settings = (await client.get("/settings/user", headers=auth())).json()
    assert (settings["canvas_enabled"], settings["canvas_allowed"]) == (False, True)
    saved = await client.put("/settings/user/canvas_enabled", headers=auth(), json={"value": True})
    assert saved.status_code == 200, saved.text
    assert (await client.get("/settings/user", headers=auth())).json()["canvas_enabled"] is True
    assert (await client.put("/settings/user/canvas_enabled", headers=auth(), json={"value": "on"})).status_code == 400
    # The read-only flag can't be written.
    assert (await client.put("/settings/user/canvas_allowed", headers=auth(), json={"value": True})).status_code == 400


async def test_user_edits_and_restores_are_new_versions_the_next_turn_sees(canvas_api):
    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    created = await canvas_create(
        tool_ctx(
            chat_id, scope_for(chat_id, request, run), CanvasCreateArgs(kind="document", title="Notes", content="one")
        )
    )
    reply = await finish(sessions, chat_id, request, run)
    item = created["item_id"]
    base = f"/chat/{chat_id}/canvas/{item}"

    saved = await client.post(f"{base}/versions", headers=auth(), json={"base_version": 1, "content": "two"})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert (body["number"], body["author"], body["title"], body["message_id"]) == (2, "user", "Notes", str(reply))
    # A stale base is a conflict, not a silent overwrite.
    stale = await client.post(f"{base}/versions", headers=auth(), json={"base_version": 1, "content": "lost"})
    assert stale.status_code == 409
    restored = await client.post(f"{base}/versions/1/restore", headers=auth(), json={"base_version": 2})
    assert restored.status_code == 200, restored.text
    assert (restored.json()["number"], restored.json()["content"]) == (3, "one")
    assert [v["author"] for v in (await client.get(base, headers=auth())).json()["versions"]] == [
        "agent",
        "user",
        "user",
    ]

    # The next turn, a child of the edited branch, reads the user's latest version.
    async with sessions() as db:
        follow = MessageModel(user_id="a", chat_id=chat_id, role="user", content="More", parent_message_id=reply)
        db.add(follow)
        await db.flush()
        await db.execute(update(MessageModel).where(MessageModel.id == reply).values(active_child_id=follow.id))
        await db.commit()
        follow_id = follow.id
    next_run = scope_for(chat_id, follow_id, uuid.uuid4())
    read = await canvas_read(tool_ctx(chat_id, next_run, CanvasReadArgs(item_id=item)))
    assert (read["version"], read["author"], read["content"]) == (3, "user", "one")

    # Others can't write; writing needs canvas on.
    assert (
        await client.post(f"{base}/versions", headers=auth("b"), json={"base_version": 3, "content": "x"})
    ).status_code == 404
    await switches(sessions, user=False)
    off = await client.post(f"{base}/versions", headers=auth(), json={"base_version": 3, "content": "x"})
    assert off.status_code == 400


async def three_items(client, sessions):
    """A finished turn that wrote a document, Python code and an HTML page."""
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    scope = scope_for(chat_id, request, run)
    made = {}
    for kind, title, content, language in [
        ("document", "Plan: v1/final", "# Plan\n\n- **Ship** 日本語\n\n![x](http://169.254.169.254/a.png)", None),
        ("code", "Parser", "def parse():\n    return 1\n", "python"),
        ("html", "Plan: v1/final", "<p>Hi</p>", None),
    ]:
        args = CanvasCreateArgs(kind=kind, title=title, content=content, language=language)
        made[kind] = (await canvas_create(tool_ctx(chat_id, scope, args)))["item_id"]
    await finish(sessions, chat_id, request, run)
    return chat_id, made


async def test_each_kind_downloads_as_its_file_types(canvas_api, monkeypatch):
    import io

    import docx
    import pdfplumber

    client, sessions = canvas_api
    chat_id, made = await three_items(client, sessions)

    def url(kind, export):
        return f"/chat/{chat_id}/canvas/{made[kind]}/versions/1/export?format={export}"

    md = await client.get(url("document", "md"), headers=auth())
    assert md.status_code == 200, md.text
    assert md.headers["content-type"].startswith("text/markdown")
    assert md.headers["content-disposition"] == (
        "attachment; filename=\"Plan v1 final.md\"; filename*=UTF-8''Plan%20v1%20final.md"
    )
    assert md.headers["x-content-type-options"] == "nosniff"
    assert md.text.startswith("# Plan")
    source = await client.get(url("code", "source"), headers=auth())
    assert source.headers["content-disposition"].endswith("filename*=UTF-8''Parser.py")
    assert source.text == "def parse():\n    return 1\n"
    page = await client.get(url("html", "html"), headers=auth())
    # Downloaded HTML is inert if opened from the API origin.
    assert page.headers["content-security-policy"].startswith("sandbox")
    assert (await client.get(url("html", "txt"), headers=auth())).text == "<p>Hi</p>"

    word = await client.get(url("document", "docx"), headers=auth())
    assert word.status_code == 200, word.text
    paragraphs = [(p.style.name, p.text) for p in docx.Document(io.BytesIO(word.content)).paragraphs]
    assert ("Heading 1", "Plan") in paragraphs and ("List Bullet", "Ship 日本語") in paragraphs
    pdf = await client.get(url("document", "pdf"), headers=auth())
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    text = pdfplumber.open(io.BytesIO(pdf.content)).pages[0].extract_text()
    assert "Plan" in text and "Ship" in text
    # Without a Unicode font, the PDF still renders, replacing what Latin-1 lacks.
    monkeypatch.setattr("asterism.domains.canvas.exports.FONT_DIRS", ())
    fallback = await client.get(url("document", "pdf"), headers=auth())
    assert (
        fallback.status_code == 200 and "Ship" in pdfplumber.open(io.BytesIO(fallback.content)).pages[0].extract_text()
    )

    # Each kind only offers its own formats; others can't download.
    assert (await client.get(url("code", "pdf"), headers=auth())).status_code == 400
    assert (await client.get(url("document", "exe"), headers=auth())).status_code == 422
    assert (await client.get(url("document", "md"), headers=auth("b"))).status_code == 404


async def test_a_chat_downloads_as_a_zip_of_current_versions(canvas_api):
    import io
    import zipfile

    client, sessions = canvas_api
    chat_id, made = await three_items(client, sessions)
    saved = await client.post(
        f"/chat/{chat_id}/canvas/{made['code']}/versions",
        headers=auth(),
        json={"base_version": 1, "content": "print(2)\n"},
    )
    assert saved.status_code == 200, saved.text
    archive = await client.get(f"/chat/{chat_id}/canvas/export", headers=auth())
    assert archive.status_code == 200, archive.text
    assert archive.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(archive.content)) as bundle:
        assert sorted(bundle.namelist()) == ["Parser.py", "Plan v1 final.html", "Plan v1 final.md"]
        assert bundle.read("Parser.py") == b"print(2)\n"
    assert (await client.get(f"/chat/{chat_id}/canvas/export", headers=auth("b"))).status_code == 404
    empty = await new_chat(client)
    assert (await client.get(f"/chat/{empty['info']['id']}/canvas/export", headers=auth())).status_code == 404


async def test_saving_a_version_to_the_library(canvas_api, monkeypatch, tmp_path):
    from asterism.domains.files.store import LocalFileStore

    store = LocalFileStore(tmp_path / "files")
    monkeypatch.setattr("asterism.domains.files.service.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.store.get_file_store", lambda: store)
    monkeypatch.setattr("asterism.domains.files.service.start_ingestion", lambda **_: None)
    client, sessions = canvas_api
    chat_id, made = await three_items(client, sessions)
    path = f"/chat/{chat_id}/canvas/{made['document']}/versions/1/library"
    saved = await client.post(path, headers=auth(), json={"format": "docx"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["filename"] == "Plan v1 final.docx"
    assert len(list((tmp_path / "files").rglob("*.docx"))) == 1
    again = await client.post(path, headers=auth(), json={"format": "docx"})
    assert again.json()["filename"] == "Plan v1 final(2).docx"
    assert (await client.post(path, headers=auth("b"), json={"format": "md"})).status_code == 404
    assert (await client.post(path, headers=auth(), json={"format": "source"})).status_code == 400


async def test_users_start_items_the_next_turn_sees(canvas_api):
    from asterism.domains.canvas.branches import Branch
    from asterism.domains.canvas.service import create_user_item

    client, sessions = canvas_api
    chat_id, request, run = await started_chat(client, sessions)
    await switches(sessions)
    reply = await finish(sessions, chat_id, request, run)
    base = f"/chat/{chat_id}/canvas"
    created = await client.post(base, headers=auth(), json={"kind": "code", "title": "Script", "language": "Python"})
    assert created.status_code == 200, created.text
    body = created.json()
    assert (body["number"], body["author"], body["language"], body["content"], body["message_id"]) == (
        1,
        "user",
        "python",
        "",
        str(reply),
    )
    assert [item["title"] for item in (await client.get(base, headers=auth())).json()] == ["Script"]

    # The next turn, a child of the reply, lists it.
    async with sessions() as db:
        follow = MessageModel(user_id="a", chat_id=chat_id, role="user", content="Fill it in", parent_message_id=reply)
        db.add(follow)
        await db.commit()
        follow_id = follow.id
    read = await canvas_read(tool_ctx(chat_id, scope_for(chat_id, follow_id, uuid.uuid4()), CanvasReadArgs()))
    assert [item["title"] for item in read["items"]] == ["Script"]

    assert (await client.post(base, headers=auth(), json={"kind": "code", "title": "No language"})).status_code == 400
    assert (await client.post(base, headers=auth("b"), json={"kind": "document", "title": "x"})).status_code == 404
    await switches(sessions, admin=False)
    assert (await client.post(base, headers=auth(), json={"kind": "document", "title": "x"})).status_code == 400
    # A chat without messages has nothing to anchor an item to.
    async with sessions() as db:
        with pytest.raises(BadDataException, match="Send a message"):
            await create_user_item(
                "a",
                chat_id,
                Branch(frozenset(), frozenset(), None),
                kind="document",
                title="x",
                language=None,
                content="",
                session=db,
            )
