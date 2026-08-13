from pydantic import BaseModel

from asterism.registries import ToolContext, tool_registry

from .fetch import fetch_markdown


class WebFetchArgs(BaseModel):
    url: str


@tool_registry.tool(description="Fetches a URL and converts content into Markdown.")
async def web_fetch(ctx: ToolContext[WebFetchArgs]) -> str:
    try:
        doc = await fetch_markdown(ctx.args.url)
        return doc.to_llm_context()
    except Exception as e:
        return f"[Fetch Error: {str(e)}]"
