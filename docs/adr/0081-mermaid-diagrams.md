# ADR-0081 — Mermaid diagrams in markdown

Status: accepted. Rendering is implemented for US-103.1 (2026-11-25); the
diagram toolbar, themes and downloads follow in US-103.2 and the agent
guidance in US-103.3 ([EPIC-103](../epics/EPIC-103-MERMAID-DIAGRAMS.md)).

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
`policy.ts`) that no caller can change:

- `securityLevel: "strict"` (labels are text, `click` and links do nothing),
  `htmlLabels: false`, `startOnLoad: false`, `suppressErrorRendering: true`;
- limits of 20,000 characters and 500 edges, and an 8 second timeout;
- a fixed system font stack.

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

## Consequences

- Mermaid and DOMPurify are new frontend dependencies, pinned exactly
  (`mermaid` 12.3.0, `dompurify` 3.4.17) and updated by Dependabot (EPIC-92).
  Mermaid brings its own `katex@0.18` for math in labels.
- Diagram text is drawn with system fonts, because an SVG image can't use the
  page's web fonts.
- The agent learns to write diagrams in US-103.3. Until then, diagrams appear
  only when a model writes mermaid on its own or a person pastes one.
