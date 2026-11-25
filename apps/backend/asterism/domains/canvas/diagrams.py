"""Draw mermaid diagrams for canvas exports (ADR-0082).

The diagram source is untrusted. It is drawn in the shared headless Chromium
(``asterism.common.headless_browser``), in an offline context where every
request is aborted, with the same mermaid bundle, locked configuration and SVG
sanitizer the app uses (``packages/diagram-policy``). The result is captured as
a PNG for DOCX and PDF. Nothing is stored, and diagram text is never logged.
"""

import asyncio
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

from playwright.async_api import BrowserContext, Page, Route

from asterism.common.headless_browser import BROWSER_SEMAPHORE, acquire_browser
from asterism.common.log import get_logger

logger = get_logger(__name__)

# apps/backend/asterism/domains/canvas/diagrams.py -> the repository (or /app).
_ROOT = Path(__file__).resolve().parents[5]
POLICY_DIR = _ROOT / "packages" / "diagram-policy"
_FRONTEND_MODULES = _ROOT / "apps" / "frontend" / "node_modules"
MERMAID_BUNDLE = _FRONTEND_MODULES / "mermaid" / "dist" / "mermaid.min.js"
DOMPURIFY_BUNDLE = _FRONTEND_MODULES / "dompurify" / "dist" / "purify.min.js"

# The page that draws: no content from the document, only scripts we ship.
_PAGE = (
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<style>html,body{margin:0;padding:0}body{background:%s}img{display:block}</style>"
    "</head><body></body></html>"
)

# Runs in the page. `source` is passed as data, never as markup.
_DRAW = """
async ({ source, config, policy, id }) => {
  globalThis.__sanitize ??= globalThis.__createDiagramSanitizer(DOMPurify, window, policy);
  mermaid.initialize(config);
  let svg;
  try {
    ({ svg } = await mermaid.render(id, source));
  } catch {
    return null;
  }
  const diagram = globalThis.__sanitize(svg);
  if (!diagram) return null;
  const css = policy.png.maxSide / policy.png.scale;
  const fit = Math.min(1, css / diagram.width, css / diagram.height);
  const image = new Image();
  image.id = "diagram";
  image.width = Math.max(1, Math.round(diagram.width * fit));
  image.height = Math.max(1, Math.round(diagram.height * fit));
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(diagram.svg);
  document.body.replaceChildren(image);
  await image.decode();
  return {
    width: image.width,
    height: image.height,
    label: diagram.label,
    description: diagram.description,
  };
}
"""


@dataclass(frozen=True)
class DrawnDiagram:
    """A diagram drawn as a PNG at ``policy.png.scale`` times its CSS size."""

    png: bytes
    width: int
    height: int
    label: str
    description: str | None


@dataclass
class _Session:
    """One offline page; ``blocked`` counts every request the page tried."""

    context: BrowserContext
    page: Page
    blocked: list[str] = field(default_factory=list)


@cache
def diagram_policy() -> dict[str, Any]:
    return json.loads((POLICY_DIR / "policy.json").read_text(encoding="utf-8"))


@cache
def _print_theme() -> dict[str, Any]:
    return json.loads((POLICY_DIR / "print-theme.json").read_text(encoding="utf-8"))


@cache
def _scripts() -> tuple[str, str, str]:
    sanitizer = (POLICY_DIR / "sanitize-svg.js").read_text(encoding="utf-8")
    return (
        MERMAID_BUNDLE.read_text(encoding="utf-8"),
        DOMPURIFY_BUNDLE.read_text(encoding="utf-8"),
        f"{sanitizer}\nglobalThis.__createDiagramSanitizer = createDiagramSanitizer;\n",
    )


def _mermaid_config() -> dict[str, Any]:
    policy, theme = diagram_policy(), _print_theme()
    if policy["mermaid"]["securityLevel"] != "strict" or policy["mermaid"]["htmlLabels"] is not False:
        raise RuntimeError("The diagram policy must keep mermaid strict, without HTML labels")
    return {**policy["mermaid"], "theme": theme["theme"], "themeVariables": theme["themeVariables"]}


async def _open(blocked: list[str] | None = None) -> _Session:
    policy = diagram_policy()
    side = policy["png"]["maxSide"] // policy["png"]["scale"]
    browser = await acquire_browser()
    context = await browser.new_context(
        offline=True,
        service_workers="block",
        java_script_enabled=True,
        device_scale_factor=policy["png"]["scale"],
        viewport={"width": side, "height": side},
    )
    session = _Session(context=context, page=await context.new_page(), blocked=blocked if blocked is not None else [])

    async def refuse(route: Route) -> None:
        session.blocked.append(route.request.url)
        await route.abort("blockedbyclient")

    await context.route("**/*", refuse)
    mermaid_js, purify_js, sanitizer_js = _scripts()
    await session.page.set_content(_PAGE % _print_theme()["themeVariables"]["background"])
    await session.page.add_script_tag(content=mermaid_js)
    await session.page.add_script_tag(content=purify_js)
    await session.page.add_script_tag(content=sanitizer_js, type="module")
    await session.page.wait_for_function("() => !!globalThis.__createDiagramSanitizer", timeout=5000)
    return session


async def _close(session: _Session | None) -> None:
    if session is None:
        return
    try:
        await session.context.close()
    except Exception:
        pass


async def _draw_one(session: _Session, source: str, index: int) -> DrawnDiagram | None:
    found = await session.page.evaluate(
        _DRAW,
        {"source": source, "config": _mermaid_config(), "policy": diagram_policy(), "id": f"export-diagram-{index}"},
    )
    if not found:
        return None
    png = await session.page.locator("#diagram").screenshot(type="png", animations="disabled")
    return DrawnDiagram(
        png=png,
        width=int(found["width"]),
        height=int(found["height"]),
        label=str(found["label"]),
        description=found["description"],
    )


async def draw_diagrams(
    sources: Sequence[str], *, deadline_seconds: float, blocked: list[str] | None = None
) -> list[DrawnDiagram | None]:
    """Draw each mermaid source, in order; ``None`` where it can't be drawn.

    Each diagram gets the policy's time limit, and the batch stops at
    ``deadline_seconds``: anything left is ``None``. A diagram that times out
    costs its page, and the next one gets a fresh page. ``blocked``, when
    given, collects every request the pages tried (all are refused).
    """
    results: list[DrawnDiagram | None] = [None] * len(sources)
    if not any(source.strip() for source in sources):
        return results
    per_diagram = diagram_policy()["renderTimeoutMs"] / 1000
    deadline = time.monotonic() + deadline_seconds
    seen = blocked if blocked is not None else []
    session: _Session | None = None
    drawn = failed = 0
    async with BROWSER_SEMAPHORE:
        try:
            for index, source in enumerate(sources):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                if not source.strip():
                    continue
                try:
                    session = session or await asyncio.wait_for(_open(seen), timeout=remaining)
                    results[index] = await asyncio.wait_for(
                        _draw_one(session, source, index), timeout=min(per_diagram, remaining)
                    )
                except TimeoutError:
                    await _close(session)
                    session = None
                except Exception as exc:
                    if "Executable doesn't exist" in str(exc):
                        logger.warning("Diagrams can't be drawn: the headless browser is not installed")
                        break
                    logger.warning(f"A diagram could not be drawn ({type(exc).__name__})")
                    await _close(session)
                    session = None
                if results[index] is None:
                    failed += 1
                else:
                    drawn += 1
        finally:
            await _close(session)
    logger.info(f"Drew {drawn} of {len(sources)} diagrams ({failed} not drawn)")
    return results


async def draw_diagram(source: str, *, deadline_seconds: float | None = None) -> DrawnDiagram | None:
    """Draw one mermaid source; ``None`` if it can't be drawn."""
    limit = deadline_seconds if deadline_seconds is not None else diagram_policy()["renderTimeoutMs"] / 1000
    return (await draw_diagrams([source], deadline_seconds=limit))[0]
