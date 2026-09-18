import asyncio

from asterism.domains.components.builtin.base_search import SafeSearch
from asterism.domains.components.builtin.searxng import SearchXNGConfig, searxng
from asterism.domains.tools.schemas import SearchArgs


async def main():
    results = await searxng(
        category="general",
        args=SearchArgs(
            query="Bracewell David AI",
            limit=3,
        ),
        config=SearchXNGConfig(
            host="https://search.bracewellfamily.org",
            safe_search=SafeSearch.OFF,
        ),
    )
    for r in results:
        print(f"Title: {r.title}")
        print(f"URL: {r.url}")
        print("-" * 40)


if __name__ == "__main__":
    asyncio.run(main())
