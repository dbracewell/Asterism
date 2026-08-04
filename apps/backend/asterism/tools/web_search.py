import asyncio
from typing import cast

from pydantic import BaseModel

from asterism.common import ToolContext
from asterism.components.search import WebsearchComponent
from asterism.components.search.base import SearchResult
from asterism.registries import component_registry, tool_registry
from asterism.utils.search import IntentBasedRetriever
from asterism.utils.web import fetch_markdown


class WebSearchArgs(BaseModel):
    query: str
    limit: int = 5


@tool_registry.tool(
    description=(
        "Searches the web for a given query and returns a summary of "
        "the results with links to the original page."
    ),
)
async def web_search(
    ctx: ToolContext[WebSearchArgs],
) -> str:
    provider = ctx.app_settings.websearch_provider
    if not provider:
        return "No web search provider configured."

    try:
        web_search: WebsearchComponent = cast(
            WebsearchComponent,
            await component_registry.get_component(
                "WebSearch",
                provider.name,
                provider.parameters,
            ),
        )
    except Exception as e:
        return f"Failed to initialize web search provider: {str(e)}"

    if not isinstance(web_search, WebsearchComponent):
        return {"message": "Invalid web search provider configured."}

    try:
        search_results = await web_search(ctx.args.query, ctx.args.limit)
        return await _research(ctx, search_results)
    except Exception as e:
        return f"Web search failed: {str(e)}"


async def _research(
    ctx: ToolContext,
    search_results: list[SearchResult],
) -> str:

    tasks = [_safe_wrap(sr.url) for sr in search_results]
    contents = await asyncio.gather(*tasks)
    retriever = IntentBasedRetriever(ctx)

    for sr, text in zip(search_results, contents):
        if isinstance(text, Exception):
            continue
        await retriever.index_document(sr.url, text)

    retrieval_results = await retriever.retrieve(top_k=10)
    return "\n\n".join(
        f"URL: {r.id}\nCONTENT: {r.content}" for r in retrieval_results
    )


async def _safe_wrap(url: str) -> str | Exception:
    try:
        return await fetch_markdown(url)
    except Exception as e:
        return e
