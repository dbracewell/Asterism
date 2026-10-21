"""Shared web-fetching pipeline used by the web_fetch and web_search tools.

Validates URLs against SSRF rules (public hosts/IPs only, http/https only, no
embedded credentials), fetches with plain HTTP first and falls back to a
headless browser for short or JavaScript-rendered pages, then converts HTML to
clean Markdown.
"""

import asyncio
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import markdownify
from bs4 import BeautifulSoup
from playwright.async_api import Browser, Playwright, Route, async_playwright

from asterism.common.log import get_logger
from asterism.core.schemas import Document

logger = get_logger("FETCH")

_MAX_REDIRECTS = 5
_PLAYWRIGHT_SEMAPHORE = asyncio.Semaphore(2)
_FORBIDDEN_HOSTNAMES = {"localhost", "localhost.localdomain"}
_FORBIDDEN_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa")

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

# Pooled headless-browser state shared by all JavaScript fetches (see
# _acquire_browser); released via close_fetch_browser during app teardown.
_playwright_instance: Playwright | None = None
_browser: Browser | None = None
_browser_lock = asyncio.Lock()


class UnsafeFetchUrlError(ValueError):
    """Raised when a URL targets a non-public host, IP address, or disallowed scheme."""


class MarkdownExtractorException(Exception):
    """Raised when no readable content remains after HTML-to-Markdown conversion."""

    def __init__(self, message: str = "Failed to extract markdown") -> None:
        super().__init__(message)


def _is_public_ip(raw_ip: str) -> bool:
    """Return True when the IP is publicly routable (SSRF guard).

    IPv4-mapped IPv6 addresses are unwrapped first so ``::ffff:127.0.0.1``
    style literals cannot slip past the checks.
    """
    ip = ipaddress.ip_address(raw_ip)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_global
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def _resolve_host_ips(hostname: str, port: int) -> list[str]:
    """Resolve a hostname to its unique IP addresses (blocking; run in a thread).

    Args:
        hostname: Host to resolve.
        port: Port used for the address lookup (affects some resolvers/records).

    Returns:
        De-duplicated list of IP strings, possibly empty.
    """
    addr_info = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    ips: list[str] = []
    for entry in addr_info:
        sockaddr = entry[4]
        ip_str = sockaddr[0]
        if ip_str not in ips:
            ips.append(ip_str)
    return ips


async def validate_public_http_url(raw_url: str) -> str:
    """Validate that a URL points at a public http/https resource.

    Rejects non-http(s) schemes, embedded credentials, localhost-style
    hostnames, and any hostname (or literal IP) that does not resolve to
    exclusively public addresses.

    Args:
        raw_url: The URL as supplied (may lack a scheme).

    Returns:
        A normalized URL string safe to fetch.

    Raises:
        UnsafeFetchUrlError: When any SSRF-relevant check fails.
    """
    candidate = raw_url.strip()
    if not candidate:
        raise UnsafeFetchUrlError("URL must not be empty.")
    if "://" not in candidate:
        candidate = f"http://{candidate}"

    parsed = urlsplit(candidate)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise UnsafeFetchUrlError(f"Unsupported URL scheme '{parsed.scheme}'. Only http and https are allowed.")

    if parsed.username is not None or parsed.password is not None:
        raise UnsafeFetchUrlError("URLs with embedded credentials are not allowed.")

    hostname = (parsed.hostname or "").strip().rstrip(".").lower()
    if not hostname:
        raise UnsafeFetchUrlError("URL must include a valid hostname.")

    if hostname in _FORBIDDEN_HOSTNAMES or hostname.endswith(_FORBIDDEN_HOST_SUFFIXES):
        raise UnsafeFetchUrlError(f"Host '{hostname}' is not allowed.")

    try:
        port = parsed.port or (443 if scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeFetchUrlError("URL contains an invalid port.") from exc

    try:
        literal_ip = ipaddress.ip_address(hostname)
    except ValueError:
        literal_ip = None

    if literal_ip is not None:
        if not _is_public_ip(str(literal_ip)):
            raise UnsafeFetchUrlError(f"IP address '{literal_ip}' is not a public routable address.")
    else:
        try:
            resolved_ips = await asyncio.to_thread(_resolve_host_ips, hostname, port)
        except socket.gaierror as exc:
            raise UnsafeFetchUrlError(f"Could not resolve hostname '{hostname}'.") from exc

        if not resolved_ips:
            raise UnsafeFetchUrlError(f"Hostname '{hostname}' did not resolve to any address.")

        for ip_str in resolved_ips:
            if not _is_public_ip(ip_str):
                raise UnsafeFetchUrlError(f"Hostname '{hostname}' resolved to non-public IP address '{ip_str}'.")

    return urlunsplit((scheme, parsed.netloc, parsed.path or "/", parsed.query, ""))


def extract_clean_markdown(html: Document) -> Document:
    """Convert an HTML Document to clean Markdown.

    Strips non-content tags (scripts, nav, forms, ...), converts the remainder
    with markdownify, and collapses blank lines.

    Args:
        html: The fetched page as a Document with an HTML body.

    Returns:
        A new text/markdown Document carrying the source metadata.

    Raises:
        MarkdownExtractorException: When no readable content remains.
    """
    soup = BeautifulSoup(html.content, "html.parser")
    for tag in soup(_HTML_TAGS_TO_REMOVE):
        tag.decompose()

    raw_markdown = markdownify.markdownify(
        str(soup),
        heading_style="ATX",
        wrap=False,
        strip=["button"],
    )

    cleaned_markdown = re.sub(r"\n\s*\n", "\n\n", raw_markdown).strip()

    if cleaned_markdown:
        return Document(
            content=cleaned_markdown.strip(),
            mime_type="text/markdown",
            metadata={"source": html.metadata.get("source", "unknown")},
        )
    else:
        raise MarkdownExtractorException()


_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",  # noqa: E501
}


async def _guard_playwright_route(route: Route) -> None:
    """Playwright route handler that re-applies SSRF validation to every request.

    Aborts sub-requests (images, scripts, XHRs) whose URL would leave the
    public web, so a fetched page cannot drag the browser into internal hosts.
    """
    try:
        await validate_public_http_url(route.request.url)
    except UnsafeFetchUrlError:
        await route.abort("accessdenied")
        return
    await route.continue_()


def _browser_is_connected(browser: Browser) -> bool:
    """Report whether the pooled browser is still usable (crashes raise)."""
    try:
        return browser.is_connected()
    except Exception:
        return False


async def _release_pool() -> None:
    """Close the pooled browser and Playwright session, best effort."""
    global _playwright_instance, _browser
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass
        _browser = None
    if _playwright_instance is not None:
        try:
            await _playwright_instance.stop()
        except Exception:
            pass
        _playwright_instance = None


async def _acquire_browser() -> Browser:
    """Return the pooled headless Chromium browser, launching it on first use.

    One browser is shared across all JavaScript fetches (a fresh page is
    created per fetch) instead of launching a new browser per call; a dead or
    disconnected browser is relaunched transparently.
    """
    global _playwright_instance, _browser
    async with _browser_lock:
        if _browser is None or not _browser_is_connected(_browser):
            await _release_pool()
            _playwright_instance = await async_playwright().start()
            _browser = await _playwright_instance.chromium.launch(headless=True)
        return _browser


async def close_fetch_browser() -> None:
    """Shut down the pooled Playwright browser; called during app teardown."""
    async with _browser_lock:
        await _release_pool()


async def _js_site_fetch(url: str) -> tuple[str, str]:
    """
    Fetches a web page using Playwright to handle JavaScript-rendered content.
    Returns the raw HTML and MIME type of the page.
    """
    validated_url = await validate_public_http_url(url)
    async with _PLAYWRIGHT_SEMAPHORE:
        browser = await _acquire_browser()
        page = await browser.new_page()
        try:
            await page.route("**/*", _guard_playwright_route)

            response = await page.goto(
                url=validated_url,
                timeout=5000,
                wait_until="networkidle",
            )
            if response is None:
                raise httpx.RequestError(f"Playwright navigation returned no response for {validated_url}")
            raw_html = await page.content()
            mime_type = response.headers.get("content-type", "text/html").split(";")[0]
            return raw_html, mime_type
        finally:
            await page.close()


def possible_js_page(html_page: str) -> bool:
    """
    Determines if a web page is likely to require JavaScript for rendering based on its HTML content.
    This function checks for specific patterns in the HTML that indicate the presence of JavaScript-driven content.
    """
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
    """Fetches a web page and returns its content as a Document object."""

    current_url = await validate_public_http_url(url)

    html_page: str = ""
    mime_type: str = "text/html"
    if force_playwright:
        html_page, mime_type = await _js_site_fetch(current_url)
    else:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
        ) as client:
            # Redirects are followed manually so every hop's target is re-validated;
            # a 302 to an internal host must be rejected, not transparently followed.
            response: httpx.Response | None = None
            for _ in range(_MAX_REDIRECTS + 1):
                response = await client.get(
                    current_url,
                    headers=_FETCH_HEADERS,
                    timeout=timeout,
                )
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        break
                    current_url = await validate_public_http_url(urljoin(current_url, location))
                    continue
                break
            else:
                raise httpx.TooManyRedirects(f"Exceeded {_MAX_REDIRECTS} redirects while fetching {url}")

            if response is None:
                raise httpx.RequestError(f"No response received while fetching {url}")
            response.raise_for_status()
            mime_type = response.headers.get("Content-Type", "text/html").split(";")[0]
            html_page = response.text
            # Short bodies (often JS shells) and known JS-framework markers are
            # refetched in a headless browser to capture rendered content.
            if len(html_page) < threshold_for_playwright or possible_js_page(html_page):
                html_page, mime_type = await _js_site_fetch(current_url)

    soup = BeautifulSoup(html_page, "html.parser")
    for tag in soup(_HTML_TAGS_TO_REMOVE):
        tag.decompose()

    html_page = soup.prettify()

    return Document(
        content=html_page,
        mime_type=mime_type,
        metadata={"source": current_url},
    )


async def fetch_markdown(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 250,
) -> Document:
    """Fetch a web page and return its content as a Markdown Document."""

    html_page = await fetch_page(url, timeout, threshold_for_playwright)
    extracted = extract_clean_markdown(html_page)
    logger.debug(f"Fetched and converted page to markdown {url}")
    return extracted
