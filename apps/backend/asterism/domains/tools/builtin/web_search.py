"""web_search tool: search the web and return fetched result pages as Markdown."""

import asyncio
from typing import Any

from asterism.common.concurrency import safe_async_call
from asterism.common.log import get_logger
from asterism.domains.components.builtin.base_search import SearchResult
from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.tools.registry import ToolContext, tool_registry
from asterism.domains.tools.schemas import SearchArgs

from .fetch import fetch_markdown

logger = get_logger("WEB_SEARCH")
_RESEARCH_FETCH_SEMAPHORE = asyncio.Semaphore(5)
# Output bounds so one tool call cannot flood the model context: at most this
# many pages, each capped per page, with a cap on the joined result.
_MAX_RESULTS_PER_SEARCH = 10
_MAX_CHARS_PER_RESULT = 8_000
_MAX_TOTAL_CHARS = 40_000


@tool_registry.tool(
    description=(
        "Searches the web for a given query and returns a summary of the results with links to the original page."
    ),
    component_type=ComponentType.WebSearch,
)
async def web_search(
    ctx: ToolContext[SearchArgs],
) -> str | dict[str, Any]:
    """Run a provider web search, then fetch each result page for context.

    Returns concatenated Markdown of the top results; missing-provider and
    search failures are returned as ``{"error": ...}`` dicts so the model can
    react to them instead of the call raising.
    """
    provider = ctx.app_settings.web_search_provider
    if not provider:
        return {"error": "No web search provider configured."}

    try:
        web_search_component = await component_registry.get_component(
            ComponentType.WebSearch,
            provider.name,
            provider.parameters,
        )
    except Exception as e:
        return {"error": f"Failed to initialize web search provider: {str(e)}"}

    try:
        search_results = await web_search_component(ctx.args)
        logger.debug(
            f"provider={provider.name} query={ctx.args.query} results in {len(search_results)} results",
        )
        return await _research(search_results)
    except Exception as e:
        return {"error": f"Web search failed: {str(e)}"}


async def _fetch_search_result(url: str):
    async with _RESEARCH_FETCH_SEMAPHORE:
        return await fetch_markdown(url)


async def _research(search_results: list[SearchResult]) -> str:
    """Fetch result pages (bounded by semaphore) and join their Markdown.

    Result URLs are de-duplicated, each page is capped at
    ``_MAX_CHARS_PER_RESULT`` characters, and the joined output is capped at
    ``_MAX_TOTAL_CHARS`` so a single tool call cannot flood the context.
    Per-URL fetch failures are swallowed (safe_async_call returns the
    exception instance, which is filtered out here) because fetching is messy
    and one bad page should not kill the whole batch.
    """
    unique_results: list[SearchResult] = []
    seen_urls: set[str] = set()
    for result in search_results[:_MAX_RESULTS_PER_SEARCH]:
        if result.url not in seen_urls:
            seen_urls.add(result.url)
            unique_results.append(result)

    tasks = [safe_async_call(_fetch_search_result(sr.url)) for sr in unique_results]
    documents = await asyncio.gather(*tasks)

    sections: list[str] = []
    total_chars = 0
    for doc in documents:
        if isinstance(doc, Exception):
            continue
        budget = min(_MAX_CHARS_PER_RESULT, _MAX_TOTAL_CHARS - total_chars)
        if budget <= 0:
            break
        text = doc.to_llm_context()
        if len(text) > budget:
            text = f"{text[:budget]}\n[Content truncated.]"
        sections.append(text)
        total_chars += len(text)

    return "\n\n".join(sections).strip()
