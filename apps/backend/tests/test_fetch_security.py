import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from asterism.domains.tools.builtin import fetch as fetch_module
from asterism.domains.tools.builtin.fetch import (
    UnsafeFetchUrlError,
    UnsupportedContentTypeError,
    fetch_page,
    validate_public_http_url,
)
from asterism.domains.tools.schemas import SearchArgs
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Route
from pydantic import ValidationError


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "unsafe_url",
    [
        "",
        "http://localhost:8000/settings/app",
        "http://sub.localhost/admin",
        "http://printer.local/",
        "http://metadata.internal/",
        "http://127.0.0.1:8000/",
        "http://[::1]:8000/",
        "http://[::ffff:127.0.0.1]/",
        "http://10.0.0.1/",
        "http://172.16.0.5/",
        "http://192.168.1.10/",
        "http://169.254.169.254/latest/meta-data/",
        "http://0.0.0.0/",
        "file:///etc/passwd",
        "ftp://93.184.216.34/resource",
        "javascript:alert(1)",
        "http://user:pass@93.184.216.34/",
    ],
)
async def test_validate_public_http_url_rejects_unsafe_targets(unsafe_url: str) -> None:
    with pytest.raises(UnsafeFetchUrlError):
        await validate_public_http_url(unsafe_url)


@pytest.mark.asyncio
async def test_validate_public_http_url_rejects_dns_resolving_to_private_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", lambda host, port: ["93.184.216.34", "127.0.0.1"])
    with pytest.raises(UnsafeFetchUrlError, match="non-public IP"):
        await validate_public_http_url("https://rebind.example.com/path")


@pytest.mark.asyncio
async def test_validate_public_http_url_accepts_public_hostname(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])
    normalized = await validate_public_http_url("example.com/docs?q=1#frag")
    assert normalized == "http://example.com/docs?q=1"


_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _serve(monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    """Route fetch_page's HTTP client through ``handler`` and resolve every host publicly."""
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])

    def client_factory(*args: object, **kwargs: Any) -> httpx.AsyncClient:
        return _REAL_ASYNC_CLIENT(*args, transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(fetch_module.httpx, "AsyncClient", client_factory)

    async def no_browser(url: str, timeout: float) -> tuple[str, str]:
        raise AssertionError(f"Playwright fallback should not run for {url}")

    monkeypatch.setattr(fetch_module, "_js_site_fetch", no_browser)


class _CountingBody(httpx.AsyncByteStream):
    """Streamed body that records how many chunks the client consumed."""

    def __init__(self, chunk: bytes, chunks: int) -> None:
        self.chunk = chunk
        self.chunks = chunks
        self.consumed = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for _ in range(self.chunks):
            self.consumed += 1
            yield self.chunk


@pytest.mark.asyncio
async def test_fetch_page_blocks_redirect_to_internal_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _serve(
        monkeypatch,
        lambda request: httpx.Response(302, headers={"Location": "http://127.0.0.1:8000/settings/app"}),
    )

    with pytest.raises(UnsafeFetchUrlError, match="not a public routable address"):
        await fetch_page("https://example.com/start")


@pytest.mark.asyncio
async def test_fetch_page_rejects_binary_without_reading_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    body = _CountingBody(b"\x00" * 65536, chunks=1024)
    _serve(
        monkeypatch,
        lambda request: httpx.Response(200, headers={"Content-Type": "application/octet-stream"}, stream=body),
    )

    with pytest.raises(UnsupportedContentTypeError, match="application/octet-stream"):
        await fetch_page("https://example.com/disk.img")
    assert body.consumed == 0


@pytest.mark.asyncio
async def test_fetch_page_stops_reading_oversized_text_at_byte_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_MAX_RESPONSE_BYTES", 10_000)
    body = _CountingBody(b"<p>" + b"a" * 4093 + b"</p>", chunks=1000)
    _serve(
        monkeypatch,
        lambda request: httpx.Response(200, headers={"Content-Type": "text/html; charset=utf-8"}, stream=body),
    )

    page = await fetch_page("https://example.com/huge")

    assert body.consumed == 3
    assert page.mime_type == "text/html"
    assert page.content.count("a") <= 10_000


@pytest.mark.asyncio
async def test_fetch_page_follows_public_redirect_and_reports_final_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(301, headers={"Location": "/final"})
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<p>" + "word " * 400 + "</p>")

    _serve(monkeypatch, handler)

    page = await fetch_page("https://example.com/start")

    assert page.metadata["source"] == "https://example.com/final"
    assert "word" in page.content


def test_search_args_limit_bounds() -> None:
    valid = SearchArgs(query="asterism", limit=10)
    assert valid.limit == 10

    with pytest.raises(ValidationError):
        SearchArgs(query="asterism", limit=0)

    with pytest.raises(ValidationError):
        SearchArgs(query="asterism", limit=11)


@pytest.mark.asyncio
async def test_brave_web_search_computes_relevance_scores_without_division_by_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from asterism.domains.components.builtin import web_search as web_search_module
    from asterism.domains.components.builtin.web_search import Brave, BraveSearchConfig

    class FakeBraveClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeBraveClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def get(self, url: str, **kwargs: object) -> httpx.Response:
            return httpx.Response(
                status_code=200,
                json={
                    "web": {
                        "results": [
                            {
                                "title": "First Result",
                                "url": "https://example.com/1",
                                "description": "First snippet",
                            },
                            {
                                "title": "Second Result",
                                "url": "https://example.com/2",
                                "description": "Second snippet",
                            },
                        ],
                    },
                },
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(web_search_module.httpx, "AsyncClient", FakeBraveClient)

    component = Brave(BraveSearchConfig(api_key="test-key"))
    results = await component(SearchArgs(query="asterism", limit=5))

    assert len(results) == 2
    assert results[0].title == "First Result"
    assert results[0].relevance_score == 1.0
    assert results[1].title == "Second Result"
    assert results[1].relevance_score == 0.5


def _rebinding_resolver(*answers: list[str]) -> Callable[[str, int], list[str]]:
    """Resolver that returns each answer in turn, like a DNS server rebinding a name."""
    remaining = list(answers)

    def resolve(host: str, port: int) -> list[str]:
        return remaining.pop(0)

    return resolve


@pytest.mark.asyncio
async def test_fetch_page_connects_to_validated_address_not_a_rebound_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<p>" + "word " * 400 + "</p>")

    _serve(monkeypatch, handler)
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", _rebinding_resolver(["93.184.216.34"], ["127.0.0.1"]))

    page = await fetch_page("https://rebind.example.com/path?q=1")

    assert len(seen) == 1
    request = seen[0]
    assert request.url.host == "93.184.216.34"
    assert request.url.scheme == "https"
    assert request.url.raw_path == b"/path?q=1"
    assert request.headers["Host"] == "rebind.example.com"
    assert request.extensions["sni_hostname"] == "rebind.example.com"
    assert page.metadata["source"] == "https://rebind.example.com/path?q=1"


@pytest.mark.asyncio
async def test_fetch_page_pins_each_redirect_hop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.headers["Host"] == "first.example.com":
            return httpx.Response(302, headers={"Location": "https://second.example.com:8443/next"})
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<p>" + "word " * 400 + "</p>")

    _serve(monkeypatch, handler)
    monkeypatch.setattr(
        fetch_module,
        "_resolve_host_ips",
        _rebinding_resolver(["93.184.216.34"], ["93.184.216.35"], ["10.0.0.1"]),
    )

    await fetch_page("https://first.example.com/")

    assert [(r.url.host, r.url.port, r.headers["Host"]) for r in seen] == [
        ("93.184.216.34", None, "first.example.com"),
        ("93.184.216.35", 8443, "second.example.com:8443"),
    ]
    assert seen[1].extensions["sni_hostname"] == "second.example.com"


@pytest.mark.asyncio
async def test_fetch_page_literal_ip_sends_no_sni_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, headers={"Content-Type": "text/html"}, text="<p>" + "word " * 400 + "</p>")

    _serve(monkeypatch, handler)

    await fetch_page("https://93.184.216.34/")

    assert seen[0].url.host == "93.184.216.34"
    assert "sni_hostname" not in seen[0].extensions


@pytest.mark.asyncio
async def test_fetch_page_never_resolves_the_hostname_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Real sockets: the name is unresolvable, so the fetch only works if httpx uses the pinned IP."""
    received_hosts: list[str] = []

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        head = (await reader.readuntil(b"\r\n\r\n")).decode()
        received_hosts.extend(
            line.split(":", 1)[1].strip() for line in head.split("\r\n") if line.lower().startswith("host:")
        )
        body = ("<p>" + "word " * 400 + "</p>").encode()
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n"
            + f"Content-Length: {len(body)}\r\n\r\n".encode()
            + body
        )
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    loopback_is_public = fetch_module._is_public_ip

    monkeypatch.setattr(fetch_module, "_is_public_ip", lambda ip: ip == "127.0.0.1" or loopback_is_public(ip))
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", _rebinding_resolver(["127.0.0.1"], ["10.0.0.1"]))

    async def no_browser(url: str, timeout: float) -> tuple[str, str]:
        raise AssertionError(f"Playwright fallback should not run for {url}")

    monkeypatch.setattr(fetch_module, "_js_site_fetch", no_browser)

    async with server:
        page = await fetch_page(f"http://rebind.invalid:{port}/page")

    assert received_hosts == [f"rebind.invalid:{port}"]
    assert "word" in page.content


def _browser_route(
    url: str,
    *,
    resource_type: str = "document",
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> MagicMock:
    route = MagicMock()
    route.request.url = url
    route.request.resource_type = resource_type
    route.request.method = method
    route.request.all_headers = AsyncMock(return_value=headers or {})
    route.request.post_data_buffer = body
    route.abort = AsyncMock()
    route.fulfill = AsyncMock()
    return route


def _mock_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.AsyncClient:
    return _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler), follow_redirects=False)


@pytest.mark.asyncio
async def test_browser_route_denies_private_requests_without_fetching() -> None:
    route = _browser_route("http://169.254.169.254/latest/meta-data/", resource_type="xhr")

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("private request must not be fetched")

    async with _mock_client(handler) as client:
        await fetch_module._serve_browser_request(client, 5.0, cast(Route, route))

    route.abort.assert_awaited_once_with("accessdenied")
    route.fulfill.assert_not_awaited()


@pytest.mark.asyncio
async def test_browser_route_skips_images_without_fetching() -> None:
    route = _browser_route("https://93.184.216.34/logo.png", resource_type="image")

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("images must not be fetched")

    async with _mock_client(handler) as client:
        await fetch_module._serve_browser_request(client, 5.0, cast(Route, route))

    route.abort.assert_awaited_once_with("blockedbyclient")


@pytest.mark.asyncio
async def test_browser_route_fulfills_through_pinned_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", _rebinding_resolver(["93.184.216.34"], ["127.0.0.1"]))
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200,
            headers=[("Content-Type", "application/json"), ("Set-Cookie", "a=1"), ("Set-Cookie", "b=2")],
            content=b'{"ok": true}',
        )

    route = _browser_route(
        "https://api.example.com/data",
        resource_type="fetch",
        method="POST",
        headers={"cookie": "session=1", "content-type": "application/json", "connection": "keep-alive", "host": "x"},
        body=b'{"q": 1}',
    )
    async with _mock_client(handler) as client:
        await fetch_module._serve_browser_request(client, 5.0, cast(Route, route))

    request = seen[0]
    assert request.method == "POST"
    assert request.url.host == "93.184.216.34"
    assert request.headers["Host"] == "api.example.com"
    assert request.headers["cookie"] == "session=1"
    assert request.extensions["sni_hostname"] == "api.example.com"
    assert request.content == b'{"q": 1}'
    route.fulfill.assert_awaited_once()
    fulfilled = route.fulfill.await_args.kwargs
    assert fulfilled["status"] == 200
    assert fulfilled["body"] == b'{"ok": true}'
    assert fulfilled["headers"]["set-cookie"] == "a=1\nb=2"
    assert "content-length" not in fulfilled["headers"]


@pytest.mark.asyncio
async def test_browser_route_follows_redirects_itself_and_drops_cross_origin_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", _rebinding_resolver(["93.184.216.34"], ["93.184.216.35"]))
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.headers["Host"] == "first.example.com":
            return httpx.Response(303, headers={"Location": "https://second.example.com/done"})
        return httpx.Response(200, headers={"Content-Type": "text/html"}, content=b"<p>done</p>")

    route = _browser_route(
        "https://first.example.com/submit",
        method="POST",
        headers={"cookie": "session=1", "authorization": "Bearer t", "content-type": "text/plain", "accept": "*/*"},
        body=b"payload",
    )
    async with _mock_client(handler) as client:
        await fetch_module._serve_browser_request(client, 5.0, cast(Route, route))

    assert [(r.method, r.url.host) for r in seen] == [("POST", "93.184.216.34"), ("GET", "93.184.216.35")]
    assert "cookie" not in seen[1].headers
    assert "authorization" not in seen[1].headers
    assert "content-type" not in seen[1].headers
    assert seen[1].content == b""
    assert seen[1].headers["accept"] == "*/*"
    assert route.fulfill.await_args.kwargs["body"] == b"<p>done</p>"


@pytest.mark.asyncio
async def test_browser_route_denies_redirect_to_private_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])
    route = _browser_route("https://example.com/start", resource_type="script")

    async with _mock_client(lambda request: httpx.Response(302, headers={"Location": "http://10.0.0.1/x"})) as client:
        await fetch_module._serve_browser_request(client, 5.0, cast(Route, route))

    route.abort.assert_awaited_once_with("accessdenied")
    route.fulfill.assert_not_awaited()


@pytest.mark.asyncio
async def test_browser_route_aborts_oversized_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_MAX_RESPONSE_BYTES", 1000)
    route = _browser_route("https://93.184.216.34/bundle.js", resource_type="script")

    async with _mock_client(lambda request: httpx.Response(200, content=b"x" * 5000)) as client:
        await fetch_module._serve_browser_request(client, 5.0, cast(Route, route))

    route.abort.assert_awaited_once_with("failed")
    route.fulfill.assert_not_awaited()


@pytest.mark.asyncio
async def test_browser_fetch_only_reaches_network_through_the_pinned_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Real Chromium: script requests go through the pinned client; private URLs are denied."""
    requests_seen: list[str] = []

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = (await reader.readuntil(b"\r\n\r\n")).decode()
        except asyncio.IncompleteReadError:
            writer.close()
            return
        request_line = head.split("\r\n", 1)[0]
        requests_seen.append(request_line)
        if " /api " in request_line:
            body, content_type = b'{"text": "rendered by script"}', b"application/json"
        else:
            body = (
                "<html><body><div id=out></div><script>"
                "fetch('/api').then(r => r.json()).then(d => { document.getElementById('out').textContent = d.text; });"
                "fetch('http://10.0.0.1/secret').catch(() => {});"
                f"try {{ new WebSocket('ws://127.0.0.1:{port}/ws'); }} catch (e) {{}}"
                "</script></body></html>"
            ).encode()
            content_type = b"text/html"
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: "
            + content_type
            + f"\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
            + body
        )
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    loopback_is_public = fetch_module._is_public_ip
    monkeypatch.setattr(fetch_module, "_is_public_ip", lambda ip: ip == "127.0.0.1" or loopback_is_public(ip))
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", lambda host, port: ["127.0.0.1"])

    try:
        async with server:
            try:
                html, mime_type = await fetch_module._js_site_fetch(f"http://site.invalid:{port}/page", 5.0)
            except Exception as exc:
                if "Executable doesn't exist" in str(exc):
                    pytest.skip("Playwright Chromium is not installed")
                raise
    finally:
        await fetch_module.close_fetch_browser()

    assert mime_type == "text/html"
    assert "rendered by script" in html
    assert sorted(requests_seen) == ["GET /api HTTP/1.1", "GET /page HTTP/1.1"]


@pytest.mark.asyncio
async def test_pooled_browser_cannot_reach_the_network_unrouted() -> None:
    """Real Chromium: without the route handler, even a loopback server is unreachable."""
    hits: list[bytes] = []

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        hits.append(await reader.read(1024))
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with server:
            try:
                browser = await fetch_module._acquire_browser()
            except Exception as exc:
                if "Executable doesn't exist" in str(exc):
                    pytest.skip("Playwright Chromium is not installed")
                raise
            context = await browser.new_context()
            try:
                page = await context.new_page()
                for url in (f"http://127.0.0.1:{port}/direct", f"http://localhost:{port}/named"):
                    with pytest.raises(PlaywrightError, match="ERR_PROXY_CONNECTION_FAILED"):
                        await page.goto(url, timeout=5000)
            finally:
                await context.close()
    finally:
        await fetch_module.close_fetch_browser()

    assert hits == []
