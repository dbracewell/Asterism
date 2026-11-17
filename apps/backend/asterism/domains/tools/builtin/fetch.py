"""Shared web-fetching pipeline used by the web_fetch and web_search tools.

Validates URLs against SSRF rules (public hosts/IPs only, http/https only, no
embedded credentials), fetches with plain HTTP first and falls back to a
headless browser for short or JavaScript-rendered pages, then converts HTML to
clean Markdown.
"""

import asyncio
import functools
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
import markdownify
from bs4 import BeautifulSoup
from playwright.async_api import Browser, Playwright, Route, async_playwright

from asterism.common.log import get_logger
from asterism.core.schemas import Document

logger = get_logger("FETCH")

_MAX_REDIRECTS = 5
# Upper bound on response bytes read from a fetched page; reading stops here and
# the page is truncated, so a huge response cannot buffer into memory.
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
# Content types worth converting to Markdown; anything else (images, archives,
# PDFs, octet streams) is rejected before its body is read.
_TEXTUAL_MIME_TYPES = {"application/xhtml+xml", "application/xml", "application/json"}
_TEXTUAL_MIME_SUFFIXES = ("+xml", "+json")
_PLAYWRIGHT_SEMAPHORE = asyncio.Semaphore(2)
_FORBIDDEN_HOSTNAMES = {"localhost", "localhost.localdomain"}
_FORBIDDEN_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".home.arpa")
# Chromium only ever receives responses the route handler fulfills: it resolves
# no names and sends anything unrouted (WebSockets, loopback included) to a dead
# proxy, so a request that slips past page routing fails instead of connecting.
_BROWSER_LAUNCH_ARGS = [
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--proxy-server=http://blackhole.invalid:9",
    "--proxy-bypass-list=<-loopback>",
]
# Sub-resources that never contribute page text; aborted instead of fetched.
_BROWSER_SKIPPED_RESOURCE_TYPES = {"image", "media", "font"}
# Connection-level headers never forwarded between Chromium and the pinned
# client; httpx decodes bodies, so encodings and lengths no longer apply.
_UNFORWARDED_HEADERS = {
    "host",
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "content-length",
    "content-encoding",
    "upgrade",
    "te",
    "trailer",
}
# Request headers dropped when a redirect leaves the original origin.
_CREDENTIAL_HEADERS = {"cookie", "authorization"}

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


class UnsupportedContentTypeError(ValueError):
    """Raised when a fetched resource is not a textual document."""


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


@dataclass(frozen=True)
class PublicUrl:
    """A URL that passed SSRF validation, with the public address it resolved to.

    Attributes:
        url: Normalized URL (hostname form) used for display and redirect joins.
        address: Public IP the hostname resolved to during validation; the
            plain-HTTP fetch connects here so the name is never resolved again.
        is_literal_ip: True when the URL already named an IP address.
    """

    url: str
    address: str
    is_literal_ip: bool


async def resolve_public_http_url(raw_url: str) -> PublicUrl:
    """Validate that a URL points at a public http/https resource and pin its address.

    Rejects non-http(s) schemes, embedded credentials, localhost-style
    hostnames, and any hostname (or literal IP) that does not resolve to
    exclusively public addresses.

    Args:
        raw_url: The URL as supplied (may lack a scheme).

    Returns:
        The normalized URL and the validated address to connect to.

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
        resolved_ips = [str(literal_ip)]
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

    return PublicUrl(
        url=urlunsplit((scheme, parsed.netloc, parsed.path or "/", parsed.query, "")),
        address=resolved_ips[0],
        is_literal_ip=literal_ip is not None,
    )


async def validate_public_http_url(raw_url: str) -> str:
    """Validate a URL as in ``resolve_public_http_url`` and return only the normalized URL."""
    return (await resolve_public_http_url(raw_url)).url


def extract_clean_markdown(html: Document) -> Document:
    """Convert an HTML Document to clean Markdown.

    Parses the HTML once, strips non-content tags (scripts, nav, forms, ...),
    converts the same tree with markdownify, and collapses blank lines. This is
    CPU-bound; async callers run it with ``asyncio.to_thread``.

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

    raw_markdown = markdownify.MarkdownConverter(
        heading_style="ATX",
        wrap=False,
        strip=["button"],
    ).convert_soup(soup)

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


def _pinned_request(
    client: httpx.AsyncClient,
    target: PublicUrl,
    timeout: float,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
) -> httpx.Request:
    """Build a request that connects to ``target.address`` instead of re-resolving its hostname.

    The URL's host is swapped for the validated IP; the original name is kept in
    the Host header and, for hostnames, as the TLS SNI name, which httpcore also
    uses to verify the certificate.
    """
    url = httpx.URL(target.url)
    extensions: dict[str, object] = {}
    if not target.is_literal_ip:
        extensions["sni_hostname"] = url.raw_host.decode("ascii")
    return client.build_request(
        method,
        url.copy_with(host=target.address),
        headers={**(_FETCH_HEADERS if headers is None else headers), "Host": url.netloc.decode("ascii")},
        content=content,
        timeout=timeout,
        extensions=extensions,
    )


def _origin(url: str) -> tuple[str, str]:
    """Return the scheme and authority that identify a URL's origin."""
    parts = urlsplit(url)
    return parts.scheme, parts.netloc


async def _send_pinned(
    client: httpx.AsyncClient,
    target: PublicUrl,
    timeout: float,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
) -> tuple[httpx.Response, PublicUrl]:
    """Send a pinned request, following redirects with every hop re-validated and pinned.

    Redirects are followed here rather than by httpx (or Chromium) so a 302 to an
    internal host is rejected, not transparently followed. Non-307/308 redirects
    become a bodiless GET, and credentials are dropped when the origin changes.

    Returns:
        The final response, opened for streaming (the caller closes it), and its URL.

    Raises:
        UnsafeFetchUrlError: When a redirect target fails validation.
        httpx.TooManyRedirects: After ``_MAX_REDIRECTS`` hops.
    """
    start_url = target.url
    for _ in range(_MAX_REDIRECTS + 1):
        request = _pinned_request(client, target, timeout, method, headers, content)
        response = await client.send(request, stream=True)
        location = response.headers.get("location") if response.is_redirect else None
        if not location:
            return response, target
        await response.aclose()
        next_target = await resolve_public_http_url(urljoin(target.url, location))
        if response.status_code not in (307, 308):
            method, content = "GET", None
            if headers is not None:
                headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
        if headers is not None and _origin(next_target.url) != _origin(target.url):
            headers = {k: v for k, v in headers.items() if k.lower() not in _CREDENTIAL_HEADERS}
        target = next_target
    raise httpx.TooManyRedirects(f"Exceeded {_MAX_REDIRECTS} redirects while fetching {start_url}")


def _fulfilled_headers(headers: httpx.Headers) -> dict[str, str]:
    """Convert response headers for ``route.fulfill``, dropping connection-level ones."""
    merged: dict[str, str] = {}
    for name, value in headers.multi_items():
        key = name.lower()
        if key in _UNFORWARDED_HEADERS:
            continue
        separator = "\n" if key == "set-cookie" else ", "
        merged[key] = f"{merged[key]}{separator}{value}" if key in merged else value
    return merged


async def _serve_browser_request(client: httpx.AsyncClient, timeout: float, route: Route) -> None:
    """Answer one Chromium request through the pinned client.

    Chromium cannot reach the network itself (see ``_BROWSER_LAUNCH_ARGS``), so
    every request comes here: skipped resource types are aborted, URLs failing
    SSRF validation are denied, and everything else (with each redirect hop) is
    fetched over its validated address with a capped body and fulfilled back.
    A body over the cap is aborted rather than truncated.
    """
    request = route.request
    if request.resource_type in _BROWSER_SKIPPED_RESOURCE_TYPES:
        await route.abort("blockedbyclient")
        return
    try:
        target = await resolve_public_http_url(request.url)
        headers = {
            name: value
            for name, value in (await request.all_headers()).items()
            if name.lower() not in _UNFORWARDED_HEADERS and not name.startswith(":")
        }
        response, _ = await _send_pinned(client, target, timeout, request.method, headers, request.post_data_buffer)
        try:
            body, truncated = await _read_capped_bytes(response)
        finally:
            await response.aclose()
    except UnsafeFetchUrlError:
        await route.abort("accessdenied")
        return
    except httpx.HTTPError:
        await route.abort("failed")
        return
    if truncated:
        await route.abort("failed")
        return
    await route.fulfill(status=response.status_code, headers=_fulfilled_headers(response.headers), body=body)


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
            _browser = await _playwright_instance.chromium.launch(headless=True, args=_BROWSER_LAUNCH_ARGS)
        return _browser


async def close_fetch_browser() -> None:
    """Shut down the pooled Playwright browser; called during app teardown."""
    async with _browser_lock:
        await _release_pool()


async def _js_site_fetch(url: str, timeout: float) -> tuple[str, str]:
    """Render a page in headless Chromium and return its HTML and media type.

    Each fetch gets a fresh browser context with service workers blocked; every
    request the page makes is served by ``_serve_browser_request`` over one
    pinned httpx client. Rendered HTML is truncated to ``_MAX_RESPONSE_BYTES``.
    """
    validated_url = await validate_public_http_url(url)
    async with _PLAYWRIGHT_SEMAPHORE, httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        browser = await _acquire_browser()
        context = await browser.new_context(service_workers="block")
        try:
            await context.route("**/*", functools.partial(_serve_browser_request, client, timeout))
            page = await context.new_page()
            response = await page.goto(
                url=validated_url,
                timeout=5000,
                wait_until="networkidle",
            )
            if response is None:
                raise httpx.RequestError(f"Playwright navigation returned no response for {validated_url}")
            mime_type = _mime_type(response.headers.get("content-type"))
            _require_textual(mime_type, validated_url)
            raw_html = await page.content()
            return raw_html[:_MAX_RESPONSE_BYTES], mime_type
        finally:
            await context.unroute_all(behavior="ignoreErrors")
            await context.close()


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


def _mime_type(content_type: str | None) -> str:
    """Return the lower-cased media type of a Content-Type header, defaulting to HTML."""
    return (content_type or "text/html").split(";")[0].strip().lower() or "text/html"


def _require_textual(mime_type: str, url: str) -> None:
    """Reject media types that cannot be converted to Markdown.

    Raises:
        UnsupportedContentTypeError: When ``mime_type`` is not textual.
    """
    if mime_type.startswith("text/") or mime_type in _TEXTUAL_MIME_TYPES or mime_type.endswith(_TEXTUAL_MIME_SUFFIXES):
        return
    raise UnsupportedContentTypeError(
        f"Unsupported content type '{mime_type}' at {url}; only text pages can be fetched."
    )


async def _read_capped_bytes(response: httpx.Response) -> tuple[bytes, bool]:
    """Stream a response body, stopping at ``_MAX_RESPONSE_BYTES``.

    Bytes past the cap are never read.

    Returns:
        The kept bytes and whether the body reached the cap.
    """
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body.extend(chunk[: _MAX_RESPONSE_BYTES - len(body)])
        if len(body) >= _MAX_RESPONSE_BYTES:
            return bytes(body), True
    return bytes(body), False


async def _read_capped_text(response: httpx.Response) -> str:
    """Read a capped body (see ``_read_capped_bytes``) and decode it.

    Uses the response's charset (UTF-8 when unknown), replacing a split character.
    """
    body, truncated = await _read_capped_bytes(response)
    if truncated:
        logger.debug(f"Truncated response at {_MAX_RESPONSE_BYTES} bytes: {response.url}")
    return body.decode(response.encoding or "utf-8", errors="replace")


async def _http_fetch(target: PublicUrl, timeout: float) -> tuple[str, str, str]:
    """Fetch ``target`` over plain HTTP with pinned, validated redirects and a bounded body.

    Every hop connects to the address that passed validation (see
    ``_send_pinned``), so DNS cannot rebind between the check and the
    connection. The final response's Content-Type is checked before its body is read.

    Args:
        target: An already validated URL and its pinned address.
        timeout: Per-request timeout in seconds.

    Returns:
        The decoded (possibly truncated) body, its media type, and the final URL.
    """
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response, target = await _send_pinned(client, target, timeout)
        try:
            response.raise_for_status()
            mime_type = _mime_type(response.headers.get("content-type"))
            _require_textual(mime_type, target.url)
            return await _read_capped_text(response), mime_type, target.url
        finally:
            await response.aclose()


async def fetch_page(
    url: str,
    timeout: float = 5.0,
    threshold_for_playwright: int = 1050,
) -> Document:
    """Fetch a web page and return its raw, unparsed body as a Document.

    Parsing and cleanup happen once, in ``extract_clean_markdown``.

    Raises:
        UnsafeFetchUrlError: When the URL or any redirect hop is not public.
        UnsupportedContentTypeError: When the resource is not a text page.
    """
    target = await resolve_public_http_url(url)
    html_page, mime_type, current_url = await _http_fetch(target, timeout)
    # Short bodies (often JS shells) and known JS-framework markers are
    # refetched in a headless browser to capture rendered content.
    if len(html_page) < threshold_for_playwright or possible_js_page(html_page):
        html_page, mime_type = await _js_site_fetch(current_url, timeout)

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
    extracted = await asyncio.to_thread(extract_clean_markdown, html_page)
    logger.debug(f"Fetched and converted page to markdown {url}")
    return extracted
