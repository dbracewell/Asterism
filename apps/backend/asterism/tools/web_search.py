import asyncio

from asterism.common import ComponentType
from asterism.components.web_search import SearchResult
from asterism.registries import ToolContext, component_registry, tool_registry
from asterism.schemas.tools import SearchArgs
from asterism.utils.log import get_logger
from asterism.utils.safe import safe_async_call

from .fetch import fetch_markdown

logger = get_logger("WEB_SEARCH")


@tool_registry.tool(
    description=(
        "Searches the web for a given query and returns a summary of "
        "the results with links to the original page."
    ),
)
async def web_search(
    ctx: ToolContext[SearchArgs],
) -> str:
    provider = ctx.app_settings.web_search_provider
    if not provider:
        return "No web search provider configured."

    try:
        web_search_component = await component_registry.get_component(
            ComponentType.WebSearch,
            provider.name,
            provider.parameters,
        )
    except Exception as e:
        return f"Failed to initialize web search provider: {str(e)}"

    try:
        search_results = await web_search_component(ctx.args)
        logger.debug(
            f"provider={provider.name} query={ctx.args.query} "
            f"results in {len(search_results)} results"
        )
        return await _research(search_results)
    except Exception as e:
        return f"Web search failed: {str(e)}"


async def _research(search_results: list[SearchResult]) -> str:
    # We capture exceptions instead of rethrowing them, because fetching
    # is messy and may be legit problems that are not fixable with another
    # call. Instead swallow them, ignore them, and move on
    tasks = [safe_async_call(fetch_markdown(sr.url)) for sr in search_results]
    documents = await asyncio.gather(*tasks)

    content = "\n\n".join(
        doc.to_llm_context() for doc in documents if not isinstance(doc, Exception)
    )

    return content.strip()
