# ADR-0081 — Mermaid diagrams in markdown

Status: accepted. Rendering (US-103.1), the diagram toolbar, themes and
downloads (US-103.2) and the agent guidance (US-103.3) are implemented
(2026-11-25) ([EPIC-103](../epics/EPIC-103-MERMAID-DIAGRAMS.md)).

## Context

Diagrams help visual learners, but the small image models behind
`generate_image` (ADR-0064) draw text badly, and most teaching diagrams are
labels and arrows. Mermaid describes such diagrams as text, which models
already write well.

All markdown in the app goes through one viewer
(`components/markdown-viewer`): chat replies, sub-agent activity, the canvas
markdown preview, Study, the in-app guide and the skill editor preview. Its
input is untrusted (ADR-0039, ADR-0040): model output, file text and other
people's material.

## Decision: a rendering, not a capability

A fenced block whose language is `mermaid` is drawn as a diagram wherever the
viewer is used. Drawing reads nothing, calls no tool and grants nothing, so
there is no admin policy, group limit, user setting or availability entry.
The markdown stays as it is: copying a message, Download my data and canvas
DOCX/PDF exports keep the fenced source (exports show it as code).

## Decision: untrusted source, locked configuration

Mermaid runs with a frozen configuration (`markdownMermaidConfig` in
`policy.ts`, read from the shared `@asterism/diagram-policy` package since
[ADR-0082](0082-diagrams-in-canvas-exports.md)) that no caller can change:

- `securityLevel: "strict"` (labels are text, `click` and links do nothing),
  `htmlLabels: false`, `startOnLoad: false`, `suppressErrorRendering: true`;
- limits of 20,000 characters and 500 edges, and an 8 second timeout;
- a fixed system font stack;
- labels wrapped at 200 px in flowcharts and state diagrams (mermaid's 120 px
  default split ordinary words such as "Light-dependent" by characters), and a
  fixed `themeCSS` rule that makes edge-label backgrounds opaque (mermaid draws
  them half transparent, so the line showed through the words). Both are our
  constants; directives still can't change `themeCSS`.

Mermaid lets a diagram change its own configuration through `%%{init}%%`
directives and frontmatter, except for the keys in `secure`, and it protects
only top-level keys. Theme values are written into the diagram's `<style>`.
So `secure` also lists `htmlLabels`, `dompurifyConfig`, `theme`,
`themeVariables`, `themeCSS`, `darkMode`, `fontFamily`, `altFontFamily` and
`look`.

## Decision: sanitize, then show as an image

The SVG mermaid returns goes through a separate DOMPurify instance with the SVG
profile. It forbids `script`, `foreignObject`, `image`, `a` and `use`, drops
event attributes, and keeps `href` only for in-document `#` references
(markers, gradients). The root gets an explicit size from its `viewBox`.

The result is shown as an `<img>` with a `data:image/svg+xml` source, never
inserted inline. An SVG image runs no scripts, loads no resources and keeps
its `<style>` to itself, so CSS that got past mermaid's checks cannot restyle
the page. The page CSP already allows `data:` images; nothing in the CSP
changed. The accessible name is the diagram's `accTitle`, or "Diagram:
<type>"; `accDescr` becomes a visually hidden caption.

Before drawing, `prepareDiagramSource` (in `packages/diagram-policy`, shared
with exports) puts `accTitle` and `accDescr` lines where mermaid accepts them
([EPIC-108](../epics/EPIC-108-DIAGRAMS-FROM-REAL-MODELS.md)). It moves them
from above the type line to just below it, and removes them from mind maps,
which refuse them. Their text still names the picture when the SVG doesn't:
mind maps, and timelines, where mermaid ignores them. The fallback type name
drops mermaid's version suffix ("flowchart", not "flowchart-v2"). Only those
lines move, so nothing a diagram may do changes, and the code view keeps the
source as written.

Considered and rejected: inline SVG (the diagram's `<style>` applies to the
whole page), and mermaid's `sandbox` level (a `data:` iframe, which
`frame-src 'self'` refuses, and a frame per diagram).

## Decision: lazy, finished, and code on failure

- Mermaid (about 1 MB with its layout dependencies) is loaded with `import()`
  the first time a diagram is drawn. Pages without diagrams load nothing new.
- Only a closed fence is drawn, so a diagram still streaming stays code. An
  unclosed fence at the end of a finished message stays code too.
- Renders run one at a time, because `mermaid.initialize` is global. Results
  are cached by theme and source (100 entries), so re-renders don't redraw.
- The server render and first client render show the code block, so hydration
  matches. The viewer reads the result through `useSyncExternalStore`, not
  Suspense.
- A parse error, a limit, a timeout, a load failure or an SVG that sanitizes to
  nothing shows the normal code block with the note "Couldn't draw this
  diagram". Mermaid's error text is never shown.

Verified in Chromium under the production CSP (`e2e/markdown-diagrams.spec.ts`):
directives are ignored and the diagram draws, HTML-looking labels draw as text,
`click` lines do nothing, and a `style` with `url()` is refused and shows as
code. No script runs, the page style is unchanged, and no request leaves.

## Decision: the diagram block (US-103.2)

- **Diagram first, code one click away.** A drawn block opens as the diagram.
  Its header has Show code / Show diagram, Expand, Download (SVG or PNG) and
  Copy (the source). The code view is the normal code block with Show diagram
  in its header; focus stays on the toggle after a switch.
- **Fit, then scroll.** Inline, a diagram shrinks to fit the column down to 75%
  of its own size, and beyond that shows at 75% in a keyboard-focusable region
  that scrolls. Expand opens a dialog at full size, named and described by
  `accTitle` and `accDescr`. The scroll areas are named groups, "Diagram: <name>" (EPIC-104 made every
  rich-content scroll area a group instead of a landmark).
- **Downloads are made in the browser** from the sanitized SVG, never uploaded:
  the SVG as is, and a PNG at 2× (at most 8,192 px a side) on the block's card
  color. The file name comes from the diagram's name (`water-cycle.png`).
- **The app palette.** Diagrams use mermaid's `base` theme with variables from
  the current palette (all palette colors are schema-checked hex). Every text
  color sits on the surface it is paired with in `themeTextPairs`, so the
  palette checks cover diagrams; a unit test checks 4.5:1 for each pair in
  every bundled theme. Pie labels take whichever of foreground or background
  contrasts best with all five chart colors. Drop shadows are off. A palette
  change draws the diagram again (the cache keys on the palette).

## Decision: the main agent is told it can draw (US-103.3)

`DIAGRAM_GUIDANCE` is in every main-agent runtime prompt, whatever tools the
run has, because a diagram is markdown and needs none. It asks for a
` ```mermaid ` block when a diagram helps (processes, sequences, hierarchies,
timelines, relationships), with short labels, punctuation in quoted labels,
`accTitle` and `accDescr`, and an explanation in words so the reply stands
without the diagram. It tells the agent not to write `click`, `style` or
`%%{init}%%` lines, which the locked configuration ignores or refuses. Since
EPIC-108 it says the type line comes first, with a short example: "Start each
diagram with accTitle" had led models to put them above the type, which
mermaid refuses. It asks for the lines on every diagram, mind maps included,
since the renderer drops them from a mind map but names the picture from
them. `scripts/evaluate_diagrams.py` measures the guidance against a live
model (US-108.2).
Sub-agents don't get it; a diagram one writes still renders.

`IMAGE_GUIDANCE` now sends pictures (illustrations, scenes, photos) to
`generate_image` and diagrams, flowcharts, mind maps, timelines and charts to
mermaid. `CANVAS_GUIDANCE` says markdown canvases can include diagrams.
Recorded turns keep their stored prompt, so resume is unaffected.

## Consequences

- Mermaid and DOMPurify are new frontend dependencies, pinned exactly
  (`mermaid` 12.3.0, `dompurify` 3.4.17) and updated by Dependabot (EPIC-92).
  Mermaid brings its own `katex@0.18` for math in labels.
- Diagram text is drawn with system fonts, because an SVG image can't use the
  page's web fonts.
