# EPIC-103: Mermaid diagrams in markdown

Status: complete (2026-11-25). US-103.1 PR #117, US-103.2 PR #118, US-103.3 PR #119, US-103.4. Source: user request (2026-11-25): "add mermaid
support to our chat markdown editor since diagrams are good for visual learners
but the small image generation models are not good at text."

## Objective

A ` ```mermaid ` fenced block in any rendered markdown shows as a diagram. The
main agent knows it can draw flowcharts, sequences, timelines, mind maps and
similar diagrams this way. It uses mermaid for diagrams that are mostly labels
and structure, and keeps `generate_image` for pictures. The diagram source stays
one click away, and a block that fails to parse falls back to the code.

Out of scope: drawing mermaid in canvas DOCX/PDF exports (they are built in
Python, `domains/canvas/exports.py`, and would need a headless browser; the
block exports as code, as it does today); a visual diagram editor; other diagram
languages (PlantUML, Graphviz); an admin or user switch (see Decisions).

## Where things stand (verified 2026-11-25)

- **One renderer.** `components/markdown-viewer/index.tsx` renders all markdown
  with `react-markdown`, `remark-gfm`, `remark-math` and `rehype-katex`, with
  `skipHtml` and a URL policy (`policy.ts`, ADR-0039/0040). Its `pre` override
  sends every fenced block to `CodeBlock` (`code-block.tsx`: language header,
  wrap toggle, copy, `react-syntax-highlighter`).
- **Callers.** Chat messages (`message-body.tsx`, `message-item.tsx`), sub-agent
  activity and delegation summaries, the canvas markdown preview
  (`canvas-panel.tsx:389`), Study notes, cards and quizzes, the in-app guide
  (`guide-markdown.tsx`) and the skill editor preview. Adding diagrams to the
  viewer reaches all of them, so the decisions below apply everywhere.
- **No mermaid in the app.** It is not a dependency. The architecture docs use
  mermaid only for GitHub rendering (`docs/architecture/CONTRIBUTING.md:93`).
- **The page CSP** (`lib/content-security-policy.ts`) allows nonce scripts with
  `'strict-dynamic'`, no `eval` in production, `style-src 'self'
'unsafe-inline'`, `img-src 'self' blob: data:` and `frame-src 'self'`. Mermaid
  renders inline SVG with a `<style>` element, which this allows. Its
  `securityLevel: "sandbox"` mode uses a `data:` iframe, which `frame-src` refuses.
- **Agent guidance** is added per offered capability in
  `domains/chat/prompt_composition.py` (`build_runtime_prompt`, :165).
  `IMAGE_GUIDANCE` (:229) currently sends any "draw/design" request to
  `generate_image`, including labelled diagrams, which small image models draw
  badly.

## Decisions (to record in ADR-0081)

- **Rendering, not a capability.** A diagram is a way of displaying markdown
  text. It grants nothing, reads nothing and needs no tool, so there is no admin
  policy, group limit or user setting, and nothing in `GET /availability`. The
  diagram guidance goes in every main-agent runtime prompt, like any other
  formatting.
- **Diagram source is untrusted.** It comes from model output, files and other
  people's text (shared course material, guide pages). Mermaid runs with:
  - `securityLevel: "strict"`: labels are text, HTML in labels is encoded, and
    `click`/`call` directives and links are off;
  - `htmlLabels: false` and no `foreignObject` output;
  - fixed `maxTextSize` and `maxEdges` limits, and a render timeout, so a large
    or crafted block falls back to code instead of locking the tab;
  - `startOnLoad: false`. The viewer calls `mermaid.render` itself, one block at
    a time.
  - mermaid's `secure` list extended so `%%{init}%%` directives and frontmatter
    cannot change labels, theme, fonts or CSS (`htmlLabels`, `theme`,
    `themeVariables`, `themeCSS`, `darkMode`, `fontFamily`, `altFontFamily`,
    `look`, `dompurifyConfig`).
    Mermaid only protects top-level keys, and theme values go straight into the
    diagram's `<style>`.
    The SVG goes through DOMPurify with an SVG-only profile: no `<script>`, event
    attributes, `<foreignObject>`, `<image>` or external `href`. It is then shown
    as an `<img>` with a `data:image/svg+xml` source, not inserted inline. An SVG
    image runs no scripts, loads nothing and keeps its `<style>` to itself, so even
    CSS that escaped mermaid's checks can't restyle the page. `img-src` already
    allows `data:`. Callers cannot change this configuration (same rule as
    `markdownMathOptions`).
- **Load it only when needed.** Mermaid is large. The viewer `import()`s it the
  first time a page has a mermaid block, so chats without diagrams load nothing
  new. Pages work during the load and show the source as code until the diagram
  is ready.
- **Draw only finished blocks.** While a message is streaming, an unclosed fence
  stays a code block. The diagram is drawn when the fence closes, so
  half-written diagrams don't flicker between errors. An unclosed fence at the
  end of a finished message stays code.
- **Fall back to the code.** A parse error, a hit limit or a load failure shows
  the normal `CodeBlock` with a short note, "Couldn't draw this diagram". The
  note never shows mermaid's error text unescaped.
- **A diagram block.** A header like `CodeBlock`'s, with the label "Diagram",
  a Diagram/Code toggle (Diagram by default), Copy source, Expand (a dialog with the diagram at full
  size, scrollable) and Download SVG/PNG. Wide diagrams scroll inside a
  keyboard-focusable region, like tables and math.
- **Accessible.** The figure has `role="img"` and an accessible name from the
  diagram's `accTitle`/`accDescr` when present, or "Diagram: <type>" otherwise.
  The Code view is the text alternative. The guidance asks the agent to include
  `accTitle` and `accDescr`.
- **Themed.** Mermaid's theme variables come from the app's tokens (background,
  foreground, border, primary, font) for the light and dark themes, and the
  diagram is redrawn when the theme changes. Contrast is checked by the
  existing theme-contrast harness.
- **Copying a message** copies the markdown source, fence included, as today.
- **Dependency rules (EPIC-92):** pin `mermaid` and `dompurify` to exact
  versions, let Dependabot update them, and keep the Trivy scan clean. Mermaid is
  MIT and DOMPurify is MPL-2.0/Apache-2.0.

## Settled (2026-11-25)

- **Every diagram type draws by default.** There is no allowlist of mermaid
  types. Each block opens as the diagram, and the Diagram/Code toggle shows its
  source.
- **SVG and PNG downloads ship in the first version** (US-103.2), for students
  who make notes. Both are made in the browser from the sanitized SVG. The PNG
  is drawn on a canvas at 2× scale on the theme's background.

## User stories

Suggested order: US-103.1 → 103.2 → 103.3 → 103.4.

### US-103.1: ADR and safe rendering

- [x] Write [ADR-0081](../adr/0081-mermaid-diagrams.md): rendering not a
      capability, the untrusted-source configuration, sanitizing, lazy loading,
      finished-block rule and fallback.
- [x] Add exact-pinned `mermaid` (12.3.0) and `dompurify` (3.4.17; 3.4.18 and
      3.5.0 were under two weeks old) to the frontend. The production build runs
      under the page CSP, and mermaid's chunk loads only when a diagram is drawn.
- [x] A fixed `markdownMermaidConfig` in `policy.ts` that callers cannot
      override, and a `DiagramBlock` the viewer's `pre` override uses for
      `language-mermaid`. Sanitize the SVG and show it as a `data:` image.
- [x] Draw only closed fences. Fall back to `CodeBlock` with the note on
      parse errors, limits, timeouts and load failures.
- [x] Unit tests (`diagram.test.tsx`): a flowchart draws; scripts, handlers,
      foreign HTML, images, links and `use` are removed; over-limit, invalid and
      timed-out blocks fall back; an unclosed fence stays code; the config is
      frozen.
- [x] Diagram cases in the `/e2e/markdown` harness and
      `e2e/markdown-diagrams.spec.ts` (draws, falls back, hostile source stays
      inert, no CSP violations).

### US-103.2: The diagram block

- [x] Header with "diagram", Show code / Show diagram, Copy source, Expand
      dialog and Download SVG/PNG (shadcn `Button`, `Hint`, `Dialog`,
      `DropdownMenu`). `saveBlob` moved to `lib/save-blob.ts` for it.
- [x] Keyboard-scrollable region named after the diagram. The image's name
      comes from `accTitle`, or "Diagram: <type>"; the dialog is described by
      `accDescr`.
- [x] Theme variables from the app palette (`diagram-theme.ts`); redraw on
      theme change; drop shadows off. The water-cycle diagram is in the
      theme-contrast harness, so the layout matrix covers it in every theme.
- [x] Layout checks at 320px (scrolls inside its block, no page overflow).
- [x] Tests: the toggle and focus, copy, expand, SVG download, the accessible
      name, the theme redraw and contrast for every bundled theme (unit); views,
      dialog, real SVG and PNG downloads, axe and 320px (Playwright).

### US-103.3: Agent guidance

- [x] Add `DIAGRAM_GUIDANCE` to `build_runtime_prompt` for the main agent (not
      sub-agents): when a diagram would help, write a ` ```mermaid ` block with
      short labels, quoted labels for punctuation, `accTitle` and `accDescr`,
      and explain it in words as well; no `click`, `style` or `%%{init}%%`.
- [x] Narrow `IMAGE_GUIDANCE`: pictures go to `generate_image`; diagrams,
      flowcharts, mind maps, timelines and charts go to mermaid.
- [x] Mention in `CANVAS_GUIDANCE` that markdown canvases can hold diagrams.
- [x] Prompt composition tests (`tests/test_diagram_guidance.py`): main agent
      with no tools, not sub-agents, order with `generate_image`, and the text.

### US-103.4: Documentation and release

- [x] User guide page `docs/guide/02-chatting/diagrams.md` with the
      `chat-diagram` screenshot (a scripted photosynthesis diagram in the demo
      dataset). `creating-images.md` points labelled diagrams to it, and the
      guide index lists it.
- [x] Diagrams in [markdown-content.md](../architecture/markdown-content.md)
      (policy table and a Diagrams section) and in
      [auth-and-security.md](../architecture/auth-and-security.md) (no CSP
      change). `pnpm docs:check` passes.
- [x] Release notes, Unreleased → Behavior: rendering and the toolbar
      (US-103.1/103.2) and the agent guidance (US-103.3). This story changes
      only documentation.
- [x] Fixes found while taking the screenshot against the real app: labels
      wrap at 200 px (mermaid's 120 px split "Light-dependent" by characters),
      edge-label backgrounds are opaque, and an inline diagram shrinks to fit
      the column down to 75% before it scrolls.
- [x] The full isolated E2E suite ran before pushing each UI story.
