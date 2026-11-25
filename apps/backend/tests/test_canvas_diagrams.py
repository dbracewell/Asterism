"""US-105.2 (ADR-0082): drawing mermaid diagrams for canvas exports.

Most cases run the real pooled Chromium and skip when it isn't installed, like
the fetch tool's browser tests.
"""

import asyncio
import json
import struct

import pytest
from asterism.common import headless_browser
from asterism.domains.canvas import diagrams
from asterism.domains.canvas.diagrams import (
    DOMPURIFY_BUNDLE,
    MERMAID_BUNDLE,
    POLICY_DIR,
    DrawnDiagram,
    draw_diagrams,
)
from asterism.domains.tools.builtin import fetch

WATER = """flowchart LR
  accTitle: Water cycle
  accDescr: Water evaporates, condenses into clouds and falls as rain.
  sea[Sea] --> cloud[Clouds] --> rain[Rain] --> sea
"""

# The same hostile sources the app's E2E spec checks (markdown-diagrams.spec.ts).
DIRECTIVE = (
    '%%{init: {"securityLevel": "loose", "htmlLabels": true, '
    '"themeCSS": "} body { display: none } .x {", "theme": "forest", '
    '"fontFamily": "x; background: url(/untrusted-markdown/font)"}}%%\n'
    "flowchart TD\n"
    "  directive --> ignored\n"
)
LABELS = """flowchart TD
  a["<img src=/untrusted-markdown/label onerror=window.__diagramPwned=1>"] --> b["<b>bold</b>"]
"""
CLICKS = """flowchart TD
  a --> b
  click a "javascript:window.__diagramPwned=1"
  click b href "/untrusted-markdown/click"
"""
STYLE_URL = """flowchart TD
  a --> b
  style b fill:url(/untrusted-markdown/fill)
"""


def png_size(png: bytes) -> tuple[int, int]:
    assert png[1:4] == b"PNG"
    width, height = struct.unpack(">II", png[16:24])
    return width, height


needs_bundles = pytest.mark.skipif(
    not (MERMAID_BUNDLE.is_file() and DOMPURIFY_BUNDLE.is_file()), reason="the frontend's packages are not installed"
)


async def drawn(sources: list[str], **options) -> list[DrawnDiagram | None]:
    return await draw_diagrams(sources, deadline_seconds=options.pop("deadline_seconds", 60), **options)


@needs_bundles
def test_the_shared_assets_are_in_place():
    for path in (POLICY_DIR / "policy.json", POLICY_DIR / "print-theme.json", POLICY_DIR / "sanitize-svg.js"):
        assert path.is_file(), path
    assert MERMAID_BUNDLE.is_file() and DOMPURIFY_BUNDLE.is_file()
    pinned = json.loads((POLICY_DIR.parents[1] / "apps" / "frontend" / "package.json").read_text())["dependencies"]
    installed = json.loads((MERMAID_BUNDLE.parents[1] / "package.json").read_text())["version"]
    assert installed == pinned["mermaid"]


def test_the_policy_must_stay_strict(monkeypatch):
    loose = json.loads((POLICY_DIR / "policy.json").read_text())
    loose["mermaid"]["securityLevel"] = "loose"
    monkeypatch.setattr(diagrams, "diagram_policy", lambda: loose)
    with pytest.raises(RuntimeError, match="strict"):
        diagrams._mermaid_config()


def test_rendering_shares_the_fetch_tools_browser_pool():
    assert fetch.BROWSER_SEMAPHORE is headless_browser.BROWSER_SEMAPHORE
    assert fetch.acquire_browser is headless_browser.acquire_browser
    assert diagrams.BROWSER_SEMAPHORE is headless_browser.BROWSER_SEMAPHORE


@pytest.mark.asyncio
async def test_a_flowchart_draws_as_a_named_2x_png(chromium):
    (water,) = await drawn([WATER])
    assert water is not None
    assert water.label == "Water cycle"
    assert water.description == "Water evaporates, condenses into clouds and falls as rain."
    assert png_size(water.png) == (water.width * 2, water.height * 2)


@pytest.mark.asyncio
async def test_invalid_and_blank_sources_are_not_drawn_and_the_rest_are(chromium):
    result = await drawn(["this is not a diagram", "   ", WATER])
    assert result[0] is None and result[1] is None
    assert result[2] is not None and result[2].label == "Water cycle"


@pytest.mark.asyncio
async def test_hostile_sources_run_nothing_and_request_nothing(chromium):
    blocked: list[str] = []
    result = await drawn([DIRECTIVE, LABELS, CLICKS, STYLE_URL], blocked=blocked)
    # The same outcome as in the app: directives ignored, HTML-looking labels
    # drawn as text, click lines inert, and a style with a URL refused.
    assert [item is not None for item in result] == [True, True, True, False]
    assert blocked == []


@pytest.mark.asyncio
async def test_a_diagram_that_hangs_costs_its_page_not_the_batch(chromium, monkeypatch):
    original = diagrams._draw_one
    calls = 0

    async def slow_first(session, source, index):
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(3600)
        return await original(session, source, index)

    monkeypatch.setattr(diagrams, "diagram_policy", lambda: {**_policy(), "renderTimeoutMs": 1500})
    monkeypatch.setattr(diagrams, "_draw_one", slow_first)
    first, second = await drawn([WATER, WATER])
    assert first is None
    assert second is not None


@pytest.mark.asyncio
async def test_the_batch_stops_at_its_deadline(chromium):
    result = await drawn([WATER] * 3, deadline_seconds=0)
    assert result == [None, None, None]


def _policy():
    return json.loads((POLICY_DIR / "policy.json").read_text())
