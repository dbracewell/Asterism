import abc
import asyncio

import httpx
from pydantic import BaseModel, ConfigDict

from asterism.common.log import DEFAULT_LOGGER
from asterism.domains.components.registry import component_registry
from asterism.domains.components.schemas import ComponentType
from asterism.domains.tools.schemas import SearchArgs

from .base_search import SearchComponent, SearchResult
from .searxng import SearchXNGConfig, searxng


class WebsearchComponent[T: BaseModel](SearchComponent[T], abc.ABC):
    component_type = ComponentType.WebSearch


class BraveSearchConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    api_key: str = ""


@component_registry.register()
class Brave(WebsearchComponent[BraveSearchConfig]):
    name: str = "BraveWebSearch"
    parameters: type[BraveSearchConfig] = BraveSearchConfig

    def __init__(self, config: BraveSearchConfig) -> None:
        super().__init__(config)

    async def __call__(self, args: SearchArgs) -> list[SearchResult]:
        search_results: list[SearchResult] = []
        page = 1

        try:
            async with httpx.AsyncClient() as client:
                params = {
                    "q": args.query,
                    "count": args.limit,
                    "safesearch": "off",
                }
                headers = {
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": self.config.api_key,
                }
                response = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params=params,
                    headers=headers,
                )
                if not response.is_success:
                    return []

                results = response.json()["web"]["results"]
                for index, result in enumerate(results):
                    search_results.append(
                        SearchResult(
                            title=result["title"],
                            url=result["url"],
                            snippet=result.get("description"),
                            relevance_score=1 / index,
                        )
                    )

                await asyncio.sleep(1)
                page += 1

        except httpx.HTTPError as e:
            DEFAULT_LOGGER.error(f"Error fetching search results: {e}")
            return []

        return search_results[: args.limit]

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}"


@component_registry.register()
class SearchXNG(WebsearchComponent[SearchXNGConfig]):
    name: str = "SearchXNGWebSearch"
    parameters: type[SearchXNGConfig] = SearchXNGConfig

    def __init__(self, config: SearchXNGConfig) -> None:
        super().__init__(config)

    async def __call__(self, args: SearchArgs) -> list[SearchResult]:
        return await searxng(
            args=args,
            category="general",
            config=self.config,
        )
