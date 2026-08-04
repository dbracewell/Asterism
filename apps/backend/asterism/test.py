import asyncio

from asterism.utils.web import fetch_markdown


async def main() -> None:
    extracted = await fetch_markdown(url="https://www.homeroomhaven.com")

    print(f"'{extracted}'")


if __name__ == "__main__":
    asyncio.run(main())
