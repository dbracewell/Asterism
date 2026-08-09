import abc
import asyncio
from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict

from asterism.common import Component, ComponentType
from asterism.registries.component import component_registry


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str | None = None


class WebsearchComponent[T: BaseModel](Component[T], abc.ABC):
    component_type = ComponentType.WebSearch

    def __init__(self, config: T) -> None:
        super().__init__(config)

    @abc.abstractmethod
    async def __call__(self, query: str, limit: int) -> list[SearchResult]: ...


class BraveSearchConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    api_key: str = ""


@component_registry.register()
class Brave(WebsearchComponent[BraveSearchConfig]):
    name: str = "BraveWebSearch"
    parameters: type[BraveSearchConfig] = BraveSearchConfig

    def __init__(self, config: BraveSearchConfig) -> None:
        super().__init__(config)

    async def __call__(self, query: str, limit: int) -> list[SearchResult]:
        search_results: list[SearchResult] = []
        page = 1

        try:
            async with httpx.AsyncClient() as client:
                params = {"q": query, "count": limit, "safesearch": "off"}
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
                for result in results:
                    search_results.append(
                        SearchResult(
                            title=result["title"],
                            url=result["url"],
                            snippet=result.get("description"),
                        )
                    )

                await asyncio.sleep(1)
                page += 1

        except httpx.HTTPError as e:
            print(f"Error fetching search results: {e}")
            return []

        return search_results[:limit]

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}"


class SearchXNGConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    host: str = "http://localhost:8080"


@component_registry.register()
class SearchXNG(WebsearchComponent[SearchXNGConfig]):
    name: str = "SearchXNGWebSearch"
    parameters: type[SearchXNGConfig] = SearchXNGConfig

    def __init__(self, config: SearchXNGConfig) -> None:
        super().__init__(config)

    async def __call__(self, query: str, limit: int) -> list[SearchResult]:
        search_results: list[SearchResult] = []
        page = 1

        while len(search_results) < limit:
            try:
                async with httpx.AsyncClient() as client:
                    params = {
                        "q": query.strip('"').strip(),
                        "format": "json",
                        "safesearch": 0,
                        "categories": "general",
                        "language": "auto",
                        "time_range": "",
                        "limit": limit,
                        "page": page,
                    }
                    response = await client.get(
                        f"{self.config.host}/search",
                        params=params,
                    )
                    if not response.is_success:
                        break

                    previous_count = len(search_results)

                    results = response.json()["results"]
                    for result in results:
                        search_results.append(
                            SearchResult(
                                title=result["title"],
                                url=result["url"],
                                snippet=result.get("content"),
                            )
                        )

                    current_count = len(search_results)
                    if current_count < previous_count + 10 or current_count >= limit:
                        break

                    await asyncio.sleep(1)
                    page += 1

            except httpx.HTTPError as e:
                print(f"Error fetching search results: {e}")
                break

        return search_results[:limit]
