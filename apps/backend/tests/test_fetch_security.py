from typing import cast
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from asterism.domains.tools.builtin import fetch as fetch_module
from asterism.domains.tools.builtin.fetch import (
    UnsafeFetchUrlError,
    _guard_playwright_route,
    fetch_page,
    validate_public_http_url,
)
from asterism.domains.tools.schemas import SearchArgs
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


@pytest.mark.asyncio
async def test_fetch_page_blocks_redirect_to_internal_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(fetch_module, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])

    class FakeAsyncClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeAsyncClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def get(self, url: str, **kwargs: object) -> httpx.Response:
            return httpx.Response(
                status_code=302,
                headers={"Location": "http://127.0.0.1:8000/settings/app"},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(fetch_module.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(UnsafeFetchUrlError, match="not a public routable address"):
        await fetch_page("https://example.com/start")


@pytest.mark.asyncio
async def test_playwright_route_guard_aborts_private_requests() -> None:
    route = MagicMock()
    route.request.url = "http://169.254.169.254/latest/meta-data/"
    route.abort = AsyncMock()
    route.continue_ = AsyncMock()

    await _guard_playwright_route(cast(Route, route))

    route.abort.assert_awaited_once_with("accessdenied")
    route.continue_.assert_not_awaited()


@pytest.mark.asyncio
async def test_playwright_route_guard_allows_public_requests() -> None:
    route = MagicMock()
    route.request.url = "https://93.184.216.34/app.js"
    route.abort = AsyncMock()
    route.continue_ = AsyncMock()

    await _guard_playwright_route(cast(Route, route))

    route.continue_.assert_awaited_once()
    route.abort.assert_not_awaited()


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
