import re

import httpx
from bs4 import BeautifulSoup
from html_to_markdown import ConversionOptions, convert
from playwright.async_api import async_playwright

from asterism.common.log import get_logger
from asterism.core.schemas import Document

logger = get_logger("FETCH")

_HTML_TAGS_TO_REMOVE = [
    "script",
    "style",
    "link",
    "noscript",
    "iframe",
    "nav",
    "footer",
    "aside",
    "header",
    "form",
    "input",
    "button",
    "select",
    "textarea",
]

_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"  # noqa: E501
}


class MarkdownExtractorException(Exception):
    def __init__(self, message: str = "Failed to extract markdown") -> None:
        super().__init__(message)


async def _js_site_fetch(url: str) -> tuple[str, str]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        response = await page.goto(
            url=url,
            timeout=5000,
            wait_until="networkidle",
        )
        raw_html = await page.content()
        mime_type = response.headers.get("content-type", "text/html").split(";")[0]  # type: ignore
        await browser.close()
        return raw_html, mime_type


def possible_js_page(html_page: str) -> bool:
    enable_javascript = re.findall(r"ENABLE\s+JAVASCRIPT", html_page, re.IGNORECASE)
    if len(enable_javascript) > 0:
        return True

    div_root = re.findall(r'<div id="root">', html_page, re.IGNORECASE)
    if len(div_root) > 0:
        return True

    return False


async def fetch_page(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 1050,
    force_playwright: bool = False,
) -> Document:
    if not url.startswith("http"):
        url = "http://" + url

    html_page: str = ""
    mime_type: str = "text/html"
    if force_playwright:
        html_page, mime_type = await _js_site_fetch(url)
    else:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            response = await client.get(
                url,
                headers=_FETCH_HEADERS,
                timeout=timeout,
            )
            response.raise_for_status
            mime_type = response.headers.get("Content-Type", "text/html").split(";")[0]
            html_page = response.text
            if len(html_page) < threshold_for_playwright or possible_js_page(html_page):
                html_page, mime_type = await _js_site_fetch(url)

    soup = BeautifulSoup(html_page, "html.parser")
    for tag in soup(_HTML_TAGS_TO_REMOVE):
        tag.decompose()

    html_page = soup.prettify()

    return Document(
        content=html_page,
        mime_type=mime_type,
        metadata={"source": url},
    )


def _convert_html_to_markdown(html: Document) -> Document:
    soup = BeautifulSoup(html.content, "html.parser")
    for tag in soup(_HTML_TAGS_TO_REMOVE):
        tag.decompose()
    clean_html = soup.prettify()

    extracted = convert(
        clean_html,
        options=ConversionOptions(
            br_in_tables=False,
            capture_svg=False,
            skip_images=True,
            extract_metadata=True,
        ),
    ).content

    if not extracted:
        raise MarkdownExtractorException()

    return Document(
        content=extracted.strip(),
        mime_type="text/markdown",
        metadata={"source": html.metadata.get("source", "unknown")},
    )


async def fetch_markdown(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 250,
) -> Document:
    html_page = await fetch_page(url, timeout, threshold_for_playwright)
    extracted = _convert_html_to_markdown(html_page)
    print(extracted, flush=True)
    logger.debug(f"Fetched and converted page to markdown {url}")
    return extracted
