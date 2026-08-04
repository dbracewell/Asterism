import abc
import asyncio
from dataclasses import dataclass
from typing import Type

import httpx
from pydantic import BaseModel, ConfigDict

from asterism.registries.component import (
    Component,
    component_registry,
)


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str | None = None


class SearchXNGConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    host: str = "http://localhost:8080"


class WebsearchComponent(Component, abc.ABC):
    @classmethod
    def component_type(cls) -> str:
        return "WebSearch"

    @abc.abstractmethod
    async def __call__(self, query: str, limit: int) -> list[SearchResult]: ...


@component_registry.register(WebsearchComponent)
class SearchXNGComponent(WebsearchComponent):
    def __init__(self, host: str) -> None:
        self.host = host

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
                        f"{self.host}/search",
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
                    if (
                        current_count < previous_count + 10
                        or current_count >= limit
                    ):
                        break

                    await asyncio.sleep(1)
                    page += 1

            except httpx.HTTPError as e:
                print(f"Error fetching search results: {e}")
                break

        return search_results[:limit]

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}({self.host})"

    @classmethod
    def name(cls) -> str:
        return "SearchXNG"

    @classmethod
    def parameters(cls) -> Type[BaseModel]:
        return SearchXNGConfig

    @classmethod
    def factory(cls, parameters: SearchXNGConfig) -> Component:
        return cls(host=parameters.host)


class DuckDuckGoConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    api_key: str = ""


@component_registry.register(WebsearchComponent)
class DuckDuckGoComponent(WebsearchComponent):
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def __call__(self, query: str, limit: int) -> list[SearchResult]:
        return []

    def __repr__(self):
        return f"{self.__class__.__name__}({self.api_key})"

    @classmethod
    def name(cls) -> str:
        return "DuckDuckGo"

    @classmethod
    def parameters(cls) -> Type[BaseModel]:
        return DuckDuckGoConfig

    @classmethod
    def factory(cls, parameters: DuckDuckGoConfig) -> Component:
        return cls(api_key=parameters.api_key)
