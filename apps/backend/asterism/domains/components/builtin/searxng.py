import asyncio

import httpx
from pydantic import BaseModel, ConfigDict, Field

from asterism.common.log import DEFAULT_LOGGER
from asterism.domains.tools.schemas import SearchArgs

from .base_search import SafeSearch, SearchResult


class SearchXNGConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    host: str = Field(
        default="http://localhost:8080",
        description="The url of the SearXNG instance",
        title="SearXNG Host",
    )
    safe_search: SafeSearch = Field(
        default=SafeSearch.MODERATE,
        description="Safe search setting",
        title="Safe Search",
    )


_SEARXNG_HEADERS = {
    "Accept": "text/html",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive",
}
_SEARXNG_SAFE_SEARCH_MAP = {
    SafeSearch.OFF: "0",
    SafeSearch.MODERATE: "1",
    SafeSearch.STRICT: "2",
}


async def searxng(
    args: SearchArgs,
    category: str,
    config: SearchXNGConfig,
) -> list[SearchResult]:
    search_results: list[SearchResult] = []
    page = 1

    while len(search_results) < args.limit:
        try:
            async with httpx.AsyncClient() as client:
                params = {
                    "q": args.query,
                    "format": "json",
                    "pageno": page,
                    "safesearch": _SEARXNG_SAFE_SEARCH_MAP[config.safe_search],
                    "language": args.search_language,
                    "time_range": args.time_range
                    if args.time_range != "all"
                    else "",
                    "categories": category,
                    "theme": "simple",
                    "image_proxy": 0,
                }
                response = await client.get(
                    f"{config.host}/search",
                    params=params,
                    headers=_SEARXNG_HEADERS,
                )
                if not response.is_success:
                    break

                previous_count = len(search_results)

                results = response.json()["results"]
                for result in results:
                    url = result.get("img_src", "") or result.get("url", "")
                    search_results.append(
                        SearchResult(
                            title=result["title"],
                            url=url,
                            snippet=result.get("content"),
                            relevance_score=result.get("score", 0.0),
                        )
                    )

                current_count = len(search_results)
                if (
                    current_count < previous_count + 10
                    or current_count >= args.limit
                ):
                    break

                await asyncio.sleep(1)
                page += 1

        except httpx.HTTPError as e:
            DEFAULT_LOGGER.error(f"Error fetching search results: {e}")
            break

    search_results.sort(key=lambda x: x.relevance_score, reverse=True)
    return search_results[: args.limit]
