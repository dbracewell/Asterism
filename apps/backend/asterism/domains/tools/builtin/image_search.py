"""image_search tool: web image search backed by an admin-configured provider."""

from typing import Any

from asterism.common.log import get_logger
from asterism.domains.components.builtin.base_search import SearchResult
from asterism.domains.components.builtin.image_search import (
    ImageSearchComponent,
)
from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.tools.registry import ToolContext, tool_registry
from asterism.domains.tools.schemas import SearchArgs

logger = get_logger("IMAGE_SEARCH")


@tool_registry.tool(
    description="Searches the web for images related to a given query",
    component_type=ComponentType.ImageSearch,
)
async def image_search(
    ctx: ToolContext[SearchArgs],
) -> dict[str, Any]:
    """Search for images using the admin-configured provider component.

    Returns a ``{url: title}`` mapping on success and an ``{"error": ...}``
    dict when no provider is configured or the search fails, so failures stay
    visible to the model.
    """
    provider = ctx.app_settings.image_search_provider
    if not provider:
        return {"error": "No image search provider configured."}

    try:
        component = await component_registry.get_component(
            ComponentType.ImageSearch,
            provider.name,
            provider.parameters,
        )
    except Exception as e:
        logger.error(
            f"Image search failed for provider={provider.name} query={ctx.args.query}: {str(e)}",
        )
        return {"error": str(e)}

    if not isinstance(component, ImageSearchComponent):
        return {"error": f"Provider '{provider.name}' is not an image search provider."}

    try:
        search_results: list[SearchResult] = await component(ctx.args)
        logger.debug(
            f"provider={provider.name} query={ctx.args.query} results in {len(search_results)} results",
        )
        return {r.url: r.title for r in search_results}
    except Exception as e:
        logger.error(
            f"Image search failed for provider={provider.name} query={ctx.args.query}: {str(e)}",
        )
        return {"error": str(e)}
