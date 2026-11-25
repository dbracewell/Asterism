"""US-107.1 (ADR-0083): canvas versions resolve file references on every read."""

import uuid

import pytest
from asterism.domains.canvas.branches import run_branch
from asterism.domains.canvas.service import Anchor, create_item
from asterism.domains.chat.inline_files import MAX_INLINE_FILES, resolve_in_live_scope
from asterism.domains.chat.prompt_composition import CANVAS_GUIDANCE, IMAGE_GUIDANCE
from asterism.domains.files.produced import register_produced_file
from asterism.domains.tools.builtin.canvas import (
    CanvasCreateArgs,
    CanvasEdit,
    CanvasReadArgs,
    CanvasUpdateArgs,
    canvas_create,
    canvas_read,
    canvas_update,
)
from test_canvas import canvas_api as _canvas_api
from test_canvas import scope_for, switches, tool_ctx
from test_chat_file_scope import upload
from test_inline_file_resolution import BARE, accepted_run, token
from test_inline_file_resolution import produced as _produced
from test_projects_api import auth
from test_projects_api import project_api as _project_api

pytestmark = pytest.mark.asyncio
produced = _produced
project_api = _project_api
canvas_api = _canvas_api

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


async def canvas_document(p, chat_id, request_id, execution, content):
    async with p.sessions() as session:
        branch = await run_branch("a", chat_id, request_id, execution.id, session)
        entry = await create_item(
            "a",
            chat_id,
            branch,
            Anchor(author="agent", message_id=request_id, execution_id=execution.id),
            kind="document",
            title="Weather",
            content=content,
            language=None,
            session=session,
        )
    return entry.item.id


async def read_version(p, chat_id, item_id, user="a"):
    return await p.client.get(f"/chat/{chat_id}/canvas/{item_id}/versions/1", headers=auth(user))


async def test_chat_files_resolve_and_everything_else_is_bare(produced):
    p = produced
    attached = await upload(p.client, "notes.txt")
    library = await upload(p.client, "library.txt")
    foreign = await upload(p.client, "foreign.txt", "b")
    chat_id, request_id, execution, scope = await accepted_run(p, [attached["id"]])
    image = await register_produced_file(scope, tool="generate_image", name="sea.png", content=PNG)
    _, _, _, other_scope = await accepted_run(p)
    elsewhere = await register_produced_file(other_scope, tool="generate_image", name="other.png", content=PNG)
    missing = uuid.uuid4()

    ids = [image.file_id, attached["id"], library["id"], foreign["id"], elsewhere.file_id, missing]
    content = "# Weather\n\n" + "\n\n".join(f"![picture]({token(i)})" for i in ids)
    item_id = await canvas_document(p, chat_id, request_id, execution, content)

    response = await read_version(p, chat_id, item_id)
    assert response.status_code == 200, response.text
    refs = response.json()["inline_files"]
    assert [ref["file_id"] for ref in refs] == [str(i) for i in ids]
    assert refs[0]["available"] is True and refs[0]["mime_type"] == "image/png"
    assert refs[0]["name"] == "sea.png" and refs[0]["role"] == "referenced"
    assert refs[0]["producing_execution_id"] is None
    assert refs[1]["available"] is True and refs[1]["name"] == "notes.txt"
    # Library-only, another user's, another chat's and missing IDs look the same.
    for ref in refs[2:]:
        assert {key: value for key, value in ref.items() if key != "file_id"} == BARE

    # Another user can't read the version at all.
    assert (await read_version(p, chat_id, item_id, "b")).status_code == 404


async def test_references_follow_the_live_scope_and_edits(produced):
    p = produced
    kept = await upload(p.client, "kept.txt")
    gone = await upload(p.client, "gone.txt")
    chat_id, request_id, execution, _ = await accepted_run(p, [kept["id"], gone["id"]])
    item_id = await canvas_document(p, chat_id, request_id, execution, f"{token(kept['id'])} {token(gone['id'])}")
    assert [ref["available"] for ref in (await read_version(p, chat_id, item_id)).json()["inline_files"]] == [
        True,
        True,
    ]

    assert (await p.client.delete(f"/files/{gone['filename']}", headers=auth())).status_code in (200, 204)
    refs = (await read_version(p, chat_id, item_id)).json()["inline_files"]
    assert [ref["available"] for ref in refs] == [True, False]
    # Resolved on read, so nothing about the removed file is kept.
    assert {key: value for key, value in refs[1].items() if key != "file_id"} == BARE

    # A user's saved edit comes back resolved too.
    await switches(p.sessions)
    saved = await p.client.post(
        f"/chat/{chat_id}/canvas/{item_id}/versions",
        headers=auth(),
        json={"base_version": 1, "content": f"Only ![kept]({token(kept['id'])})"},
    )
    assert saved.status_code == 200, saved.text
    assert [(ref["file_id"], ref["available"]) for ref in saved.json()["inline_files"]] == [(kept["id"], True)]


async def test_text_without_references_and_the_limit(produced, monkeypatch):
    p = produced
    chat_id, _, _, scope = await accepted_run(p)
    files = [
        await register_produced_file(scope, tool="generate_image", name=f"{n}.png", content=PNG + bytes([n]))
        for n in range(4)
    ]
    monkeypatch.setattr("asterism.domains.chat.inline_files.MAX_INLINE_FILES", 3)
    text = " ".join(token(file.file_id) for file in files)
    async with p.sessions() as session:
        assert await resolve_in_live_scope(user_id="a", chat_id=chat_id, text="# No files", session=session) == []
        refs = await resolve_in_live_scope(user_id="a", chat_id=chat_id, text=text, session=session)
    assert [ref.available for ref in refs] == [True, True, True, False]
    assert MAX_INLINE_FILES == 32


def test_the_agent_is_told_it_can_put_images_in_a_canvas():
    # US-107.2: the same Markdown as a reply, from ids this conversation gave it.
    assert "![short description](asterism-file:<file id>)" in CANVAS_GUIDANCE
    assert "generate_image" in CANVAS_GUIDANCE and "unavailable" in CANVAS_GUIDANCE
    # The image guidance no longer forbids the ids outright, only repeating them in the reply.
    assert "don't repeat them in your reply" in IMAGE_GUIDANCE


async def test_canvas_tools_keep_references_and_the_preview_resolves_them(produced, canvas_api):
    p = produced
    chat_id, request_id, execution, scope = await accepted_run(p)
    await switches(p.sessions)
    image = await register_produced_file(scope, tool="generate_image", name="sea.png", content=PNG)
    embed = f"![The sea]({token(image.file_id)})"
    tools = scope_for(chat_id, request_id, execution.id)

    created = await canvas_create(
        tool_ctx(chat_id, tools, CanvasCreateArgs(kind="document", title="Sea", content=f"# Sea\n\n{embed}\n"))
    )
    await canvas_update(
        tool_ctx(
            chat_id,
            tools,
            CanvasUpdateArgs(item_id=created["item_id"], edits=[CanvasEdit(find="# Sea", replace="# The sea")]),
        )
    )
    read = await canvas_read(tool_ctx(chat_id, tools, CanvasReadArgs(item_id=created["item_id"])))
    assert read["content"] == f"# The sea\n\n{embed}\n"
    assert "inline_files" not in read

    response = await p.client.get(f"/chat/{chat_id}/canvas/{created['item_id']}/versions/2", headers=auth())
    assert response.status_code == 200, response.text
    (ref,) = response.json()["inline_files"]
    assert ref["file_id"] == str(image.file_id) and ref["available"] is True
