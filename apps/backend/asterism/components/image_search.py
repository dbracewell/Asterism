import abc
import asyncio
from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict

from asterism.common import Component, ComponentType
from asterism.registries import component_registry


@dataclass
class ImageSearchResult:
    title: str
    url: str
    snippet: str


class ImageSearchComponent[T: BaseModel](Component[T], abc.ABC):
    component_type = ComponentType.ImageSearch

    def __init__(self, config: T) -> None:
        super().__init__(config)

    @abc.abstractmethod
    async def __call__(self, query: str, limit: int) -> list[ImageSearchResult]: ...


class SearchXNGConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    host: str = "http://localhost:8080"


@component_registry.register()
class SearchXNG(ImageSearchComponent[SearchXNGConfig]):
    name: str = "SearchXNGImageSearch"
    parameters: type[SearchXNGConfig] = SearchXNGConfig

    def __init__(self, config: SearchXNGConfig) -> None:
        super().__init__(config)

    async def __call__(self, query: str, limit: int) -> list[ImageSearchResult]:
        search_results: list[ImageSearchResult] = []
        page = 1

        while len(search_results) < limit:
            try:
                async with httpx.AsyncClient() as client:
                    params = {
                        "q": query.strip('"').strip(),
                        "format": "json",
                        "safesearch": 0,
                        "categories": "images",
                        "language": "auto",
                        "time_range": "",
                        "limit": limit,
                        "page": page,
                    }
                    response = await client.get(
                        f"{self.config.host}/search",
                        params=params,
                    )
                    print(response.request.url)
                    if not response.is_success:
                        break

                    previous_count = len(search_results)

                    results = response.json()["results"]
                    for result in results:
                        search_results.append(
                            ImageSearchResult(
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
