"""The one pooled headless Chromium, shared by the web fetch tool (ADR-0065)
and the canvas export diagram renderer (ADR-0082).

One browser is launched on first use and reused; each caller opens its own
context and closes it. A dead or disconnected browser is relaunched
transparently. ``BROWSER_SEMAPHORE`` bounds how many pages run at once across
all callers, so one feature can't starve the other or launch more browsers.
"""

import asyncio

from playwright.async_api import Browser, Playwright, async_playwright

# Chromium only ever receives responses a route handler fulfills: it resolves
# no names and sends anything unrouted (WebSockets, loopback included) to a dead
# proxy, so a request that slips past page routing fails instead of connecting.
BROWSER_LAUNCH_ARGS = [
    "--host-resolver-rules=MAP * ~NOTFOUND",
    "--proxy-server=http://blackhole.invalid:9",
    "--proxy-bypass-list=<-loopback>",
]

# At most this many browser pages work at once, across every caller.
BROWSER_SEMAPHORE = asyncio.Semaphore(2)

_playwright_instance: Playwright | None = None
_browser: Browser | None = None
_browser_lock = asyncio.Lock()


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


async def acquire_browser() -> Browser:
    """Return the pooled headless Chromium browser, launching it on first use."""
    global _playwright_instance, _browser
    async with _browser_lock:
        if _browser is None or not _browser_is_connected(_browser):
            await _release_pool()
            _playwright_instance = await async_playwright().start()
            _browser = await _playwright_instance.chromium.launch(headless=True, args=BROWSER_LAUNCH_ARGS)
        return _browser


async def close_browser() -> None:
    """Shut down the pooled browser; called during app teardown."""
    async with _browser_lock:
        await _release_pool()
