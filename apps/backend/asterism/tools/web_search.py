import asyncio
from typing import cast

from pydantic import BaseModel

from asterism.common import ComponentType
from asterism.components.web_search import SearchResult, WebsearchComponent
from asterism.registries import ToolContext, component_registry, tool_registry
from asterism.utils.log import get_logger

from .fetch import fetch_markdown
from .retrieval import SummarizingRetriever

logger = get_logger("WEB_SEARCH")


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
    provider = ctx.app_settings.web_search_provider
    if not provider:
        return "No web search provider configured."

    try:
        web_search_component: WebsearchComponent = cast(
            WebsearchComponent,
            await component_registry.get_component(
                ComponentType.WebSearch,
                provider.name,
                provider.parameters,
            ),
        )
    except Exception as e:
        return f"Failed to initialize web search provider: {str(e)}"

    try:
        search_results = await web_search_component(ctx.args.query, ctx.args.limit)
        logger.debug(
            f"provider={provider.name} query={ctx.args.query} "
            f"results in {len(search_results)} results"
        )
        return await _research(ctx, search_results)
    except Exception as e:
        return f"Web search failed: {str(e)}"


async def _research(
    ctx: ToolContext,
    search_results: list[SearchResult],
) -> str:

    tasks = [_safe_wrap(sr.url) for sr in search_results]
    contents = await asyncio.gather(*tasks)
    retriever = SummarizingRetriever(ctx)
    # IntentBasedRetriever(ctx)

    for sr, text in zip(search_results, contents):
        if isinstance(text, Exception):
            continue
        await retriever.index_document(sr.url, text)

    retrieval_results = await retriever.retrieve(top_k=50)
    content_blocks = ""
    for r in retrieval_results:
        content_blocks += f"\n\nURL: {r.id}\nCONTENT: {r.content}"

    logger.info(content_blocks)
    return content_blocks.strip()


async def _safe_wrap(url: str) -> str | Exception:
    try:
        return await fetch_markdown(url)
    except Exception as e:
        return e
