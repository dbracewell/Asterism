import re

import httpx
from bs4 import BeautifulSoup
from html_to_markdown import ConversionOptions, convert
from playwright.async_api import async_playwright

from asterism.utils.log import get_logger


async def _js_site_fetch(url: str) -> str:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto(
            url=url,
            timeout=5000,
            wait_until="networkidle",
        )
        raw_html = await page.content()
        await browser.close()
        return raw_html


async def fetch_page(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 250,
) -> str | None:
    if not url.startswith("http"):
        url = "http://" + url
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"  # noqa: E501
        }
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            response = await client.get(url, headers=headers)
            if not response.is_success:
                return None
            html_page = response.text
            soup = BeautifulSoup(html_page, "html.parser")
            text = soup.prettify()
            is_js_site = (
                len(re.findall(r"ENABLE\s+JAVASCRIPT", text, re.IGNORECASE)) > 0
                or len(text) < threshold_for_playwright
            )
            if is_js_site:
                html_page = await _js_site_fetch(url)
            return html_page
    except Exception:
        return None


def _convert_html_to_markdown(html: str) -> str | None:
    clean_html = re.sub(
        r'<script\b[^>]*type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)<\/script>',
        "",
        html,
        flags=re.IGNORECASE,
    )
    extracted = convert(
        clean_html,
        options=ConversionOptions(
            br_in_tables=False,
            capture_svg=False,
            skip_images=True,
            extract_metadata=True,
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


logger = get_logger("FETCH_MARKDOWN")


async def fetch_markdown(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 250,
) -> str:
    html_page = await fetch_page(
        url,
        timeout,
        threshold_for_playwright,
    )
    if not html_page:
        logger.error(f"Failed to fetch page {url}")
        raise Exception(f"[Fetch Error: failed to fetch page {url}]")

    extracted = _convert_html_to_markdown(html_page)
    if not extracted:
        logger.error(f"Failed to convert page to markdown {url}")
        raise Exception(f"[Fetch Error: failed to convert page to markdown {url}]")

    logger.debug(f"Fetched and converted page to markdown {url}")
    return extracted
