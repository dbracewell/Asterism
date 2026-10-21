"""web_fetch tool: fetch a single URL and return its content as Markdown."""

from typing import Any

from pydantic import BaseModel

from asterism.domains.tools.registry import ToolContext, tool_registry

from .fetch import fetch_markdown


class WebFetchArgs(BaseModel):
    """Arguments for web_fetch."""

    url: str


@tool_registry.tool(description="Fetches a URL and converts content into Markdown.")
async def web_fetch(ctx: ToolContext[WebFetchArgs]) -> str | dict[str, Any]:
    """Fetch ``args.url`` and return its content as Markdown.

    Fetch failures are returned as an ``{"error": ...}`` dict (not raised) so
    the model can see what went wrong and decide how to proceed.
    """
    try:
        doc = await fetch_markdown(ctx.args.url)
        return doc.to_llm_context()
    except Exception as e:
        return {"error": str(e)}
