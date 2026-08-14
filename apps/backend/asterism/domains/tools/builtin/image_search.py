import asyncio
from typing import cast
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from asterism.common.log import get_logger
from asterism.domains.components.builtin.base_search import SearchResult
from asterism.domains.components.builtin.image_search import ImageSearchComponent
from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.tools.registry import ToolContext, tool_registry
from asterism.domains.tools.schemas import SearchArgs

from .fetch import fetch_page

logger = get_logger("IMAGE_SEARCH")


@tool_registry.tool(
    description="Searches the web for images related to a given query",
)
async def image_search(
    ctx: ToolContext[SearchArgs],
) -> dict:
    provider = ctx.app_settings.image_search_provider
    if not provider:
        return {
            "status": "error",
            "message": "No image search provider configured.",
        }

    try:
        image_search_component: ImageSearchComponent = cast(
            ImageSearchComponent,
            await component_registry.get_component(
                ComponentType.ImageSearch,
                provider.name,
                provider.parameters,
            ),
        )
    except Exception as e:
        logger.error(
            f"Image search failed for provider={provider.name} "
            f"query={ctx.args.query}: {str(e)}"
        )
        return {"status": "error", "message": str(e)}

    try:
        search_results = await image_search_component(ctx.args)
        logger.debug(
            f"provider={provider.name} query={ctx.args.query} "
            f"results in {len(search_results)} results"
        )

        tasks = [_gather_images(sr) for sr in search_results]
        results = await asyncio.gather(*tasks)
        return_dict = {}
        for rl in results:
            for r in rl:
                return_dict[r[0]] = r[1]

        logger.debug(
            f"Gathered {len(return_dict)} image results for query={ctx.args.query}"
        )
        return return_dict

    except Exception as e:
        logger.error(
            f"Image search failed for provider={provider.name} "
            f"query={ctx.args.query}: {str(e)}"
        )
        return {"status": "error", "message": str(e)}


async def _gather_images(
    search_result: SearchResult,
) -> list[tuple[str, str]]:
    html = await fetch_page(search_result.url)
    if not html:
        return []

    soup = BeautifulSoup(html.content, "html.parser")
    images: list[tuple[str, str]] = []
    for img_tag in soup.find_all("img"):
        img_url = img_tag.get("src")
        if not img_url or str(img_url).startswith("data:"):
            continue
        img_alt = img_tag.get("alt", search_result.title or search_result.snippet or "")
        if not img_alt:
            continue
        absolute_url = urljoin(search_result.url, str(img_url))
        images.append((absolute_url, str(img_alt)))
    return images
