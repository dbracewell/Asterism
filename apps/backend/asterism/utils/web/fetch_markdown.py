import httpx
from html_to_markdown import ConversionOptions, convert
from playwright.async_api import async_playwright


def _convert_html_to_markdown(html: str) -> str | None:
    extracted = convert(
        html,
        options=ConversionOptions(
            br_in_tables=False,
            capture_svg=False,
            skip_images=True,
            extract_metadata=False,
            strip_tags=[
                "script",
                "style",
                "nav",
                "footer",
                "header",
                "aside",
                "nav",
                "header",
            ],
        ),
    ).content

    return extracted.strip() if extracted else None


async def _js_site_fetch(url: str) -> str:
    async with async_playwright() as p:
        browser = await p.firefox.launch()
        page = await browser.new_page()

        await page.goto(
            url=url,
            timeout=5000,
            wait_until="networkidle",
        )
        raw_html = await page.content()
        print(raw_html)
        await browser.close()

        markdown = _convert_html_to_markdown(raw_html)
        if not markdown:
            raise Exception("[Fetch Error: converting document to markdown]")

        return markdown


async def fetch_markdown(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 250,
    words_limit: int | None = None,
) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"  # noqa: E501
    }
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
    ) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status

        extracted = _convert_html_to_markdown(response.text)
        if not extracted:
            extracted = await _js_site_fetch(url)
        else:
            extracted = extracted.strip()
            if len(extracted) < threshold_for_playwright:
                extracted = await _js_site_fetch(url)

        words = extracted.split()
        if words_limit and len(words) > words_limit:
            extracted = (
                " ".join(words[:words_limit]) + "\n...[Content Truncated]"
            )

        return extracted.replace("\xa0", " ")
