import asyncio

from asterism.domains.tools.builtin.fetch import fetch_markdown


async def main():
    url = "https://www.davidbracewell.com"  # Replace with the URL you want to test

    doc = await fetch_markdown(url, include_images=True)
    print(doc.content)


if __name__ == "__main__":
    asyncio.run(main())
