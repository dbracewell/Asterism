"""Canvas tools for the main agent: create, update and read (ADR-0063).

Context-managed: offered only when the admin policy and the user's setting are
on, in an ordinary chat, with a tool-capable model. Every call rechecks both
switches and works on the run's own branch: the run's request message and its
ancestors, plus the run itself. Results carry ids and version numbers, never
the content written, so the persisted tool results link a message to the
versions it produced.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from asterism.core.exceptions import BadDataException
from asterism.domains.canvas.schemas import MAX_EDITS, MAX_TITLE_LENGTH
from asterism.domains.tools.registry import ToolContext, tool_registry


class CanvasCreateArgs(BaseModel):
    kind: Literal["document", "code", "html"] = Field(
        description="document for Markdown prose, code for a program, html for a web page"
    )
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    content: str = Field(description="The full text: Markdown, source code or HTML")
    language: str | None = Field(
        default=None, max_length=32, description="Required for code, e.g. python or typescript"
    )


class CanvasEdit(BaseModel):
    find: str = Field(min_length=1, description="Text that occurs exactly once in the current version")
    replace: str


class CanvasUpdateArgs(BaseModel):
    item_id: str = Field(description="The canvas item's id")
    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE_LENGTH)
    content: str | None = Field(default=None, description="The whole new text; replaces the current version")
    edits: list[CanvasEdit] | None = Field(
        default=None, max_length=MAX_EDITS, description="Targeted changes applied in order"
    )

    @model_validator(mode="after")
    def _one_change(self):
        if self.content is not None and self.edits is not None:
            raise ValueError("Give either content or edits, not both")
        if self.content is None and self.edits is None and self.title is None:
            raise ValueError("Give content, edits or a new title")
        return self


class CanvasReadArgs(BaseModel):
    item_id: str | None = Field(default=None, description="Omit to list the canvas items in this conversation")


async def _run_branch(ctx: ToolContext, session):
    """The authorized run's branch; refuses calls outside a recorded main-agent run."""
    from asterism.domains.canvas.branches import run_branch
    from asterism.domains.canvas.policy import require_canvas

    scope = ctx.execution_scope
    if (
        scope is None
        or scope.is_sub_agent
        or scope.request_message_id is None
        or scope.execution_id is None
        or scope.user_id != ctx.user.id
        or scope.chat_id != ctx.session.info.id
    ):
        raise BadDataException("Canvas is unavailable outside a recorded main-agent run")
    await require_canvas(ctx.user.id, scope.chat_id, session)
    branch = await run_branch(ctx.user.id, scope.chat_id, scope.request_message_id, scope.execution_id, session)
    return scope, branch


def _item_id(value: str):
    import uuid

    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise BadDataException("Unknown canvas item id; use canvas_read to list items") from exc


@tool_registry.tool(
    name="canvas_create",
    description="Create a canvas item (a document, program or web page) shown beside the chat.",
)
async def canvas_create(ctx: ToolContext[CanvasCreateArgs]) -> dict[str, object]:
    from asterism.db.database import get_async_db_session
    from asterism.domains.canvas.service import Anchor, create_item

    async with get_async_db_session() as session:
        scope, branch = await _run_branch(ctx, session)
        entry = await create_item(
            ctx.user.id,
            scope.chat_id,
            branch,
            Anchor(author="agent", message_id=scope.request_message_id, execution_id=scope.execution_id),
            kind=ctx.args.kind,
            title=ctx.args.title,
            content=ctx.args.content,
            language=ctx.args.language,
            session=session,
        )
        return {
            "item_id": str(entry.item.id),
            "version": entry.current.number,
            "kind": entry.item.kind,
            "language": entry.item.language,
            "title": entry.current.title,
        }


@tool_registry.tool(
    name="canvas_update",
    description=(
        "Change a canvas item: targeted edits (each find text must occur exactly once) "
        "or the whole new content, and optionally a new title. Creates a new version."
    ),
)
async def canvas_update(ctx: ToolContext[CanvasUpdateArgs]) -> dict[str, object]:
    from asterism.db.database import get_async_db_session
    from asterism.domains.canvas.service import Anchor, add_version

    async with get_async_db_session() as session:
        scope, branch = await _run_branch(ctx, session)
        entry = await add_version(
            ctx.user.id,
            scope.chat_id,
            _item_id(ctx.args.item_id),
            branch,
            Anchor(author="agent", message_id=scope.request_message_id, execution_id=scope.execution_id),
            title=ctx.args.title,
            content=ctx.args.content,
            edits=[(edit.find, edit.replace) for edit in ctx.args.edits] if ctx.args.edits is not None else None,
            session=session,
        )
        return {"item_id": str(entry.item.id), "version": entry.current.number, "title": entry.current.title}


@tool_registry.tool(
    name="canvas_read",
    description="List this conversation's canvas items, or read one item's current text.",
)
async def canvas_read(ctx: ToolContext[CanvasReadArgs]) -> dict[str, object]:
    from asterism.db.database import get_async_db_session
    from asterism.domains.canvas.service import full_version, summary, visible_item, visible_items

    async with get_async_db_session() as session:
        scope, branch = await _run_branch(ctx, session)
        if ctx.args.item_id is None:
            items = await visible_items(ctx.user.id, scope.chat_id, branch, session)
            return {"items": [summary(entry).model_dump(mode="json") for entry in items]}
        entry = await visible_item(ctx.user.id, scope.chat_id, _item_id(ctx.args.item_id), branch, session)
        version = full_version(entry)
        return {
            "item_id": str(entry.item.id),
            "kind": version.kind,
            "language": version.language,
            "title": version.title,
            "version": version.number,
            "author": version.author,
            "content": version.content,
        }
