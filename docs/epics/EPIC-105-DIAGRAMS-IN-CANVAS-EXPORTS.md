# EPIC-105: Diagrams in canvas exports

Status: in progress (2026-11-25). US-105.1 PR #123; US-105.2 implemented. Source: user request (2026-11-25), the
follow-up left out of [EPIC-103](EPIC-103-MERMAID-DIAGRAMS.md): "Draw
diagrams in canvas DOCX/PDF exports."

## Objective

A document canvas's DOCX and PDF downloads, the chat's canvas ZIP and Save to
Files show each ` ```mermaid ` block as the drawn diagram, the same as the app
shows it, with its name as alt text. Markdown and text downloads keep the
source. A diagram that can't be drawn exports as code, as it does today.

Out of scope: diagrams in chat-message exports or Download my data (both keep
markdown source); new export formats; drawing diagrams in HTML canvases.

## Where things stand (verified 2026-11-25)

- **Exports are made on the server.** `domains/canvas/exports.py` parses markdown
  with `markdown_it` (commonmark, tables, no HTML, no images) and writes DOCX
  (`python-docx`, `markdown_docx`) and PDF (`fpdf2`, `markdown_pdf`). Every
  `fence` becomes a code paragraph (`exports.py:198`). Document canvases export
  as `md`, `txt`, `docx` and `pdf` (`FORMATS`, :25).
- **Three ways out.** `downloads.py` has `export_item_version` (one version, one
  format), `export_chat` (every item as a ZIP) and `save_to_library` (a version
  into the Files library, then knowledge processing).
- **A headless browser is already in the image.** The web fetch tool
  (`tools/builtin/fetch.py`, ADR-0065) pools one Playwright Chromium
  (`_acquire_browser`, semaphore of 2), opens a fresh context per use and routes
  every request through its own handler. The browser has no network of its own.
- **The app draws diagrams in the browser** (ADR-0081): a locked mermaid
  configuration, a DOMPurify pass, and the SVG shown as a `data:` image.
  Mermaid is a frontend dependency (12.3.0). The runtime image already holds
  the frontend's production `node_modules` (mermaid and DOMPurify included) at
  `/app/apps/frontend/node_modules`, beside the backend.

## Decisions (to record in an ADR)

- **Draw on the server, with the same rules.** The backend renders each mermaid
  block in the pooled Chromium, in a fresh context where **every request is
  aborted**, from a static page holding the mermaid bundle, the same locked
  configuration and the same sanitizer as the app. No user content reaches the
  page except the diagram source, passed as data. The result is a PNG at 2× for
  both DOCX and PDF; Word and fpdf2's SVG support is too uneven.
- **One mermaid, one configuration.** The server loads the mermaid and
  DOMPurify bundles the image already ships for the app, and `check:image`
  verifies they are there and that mermaid is the frontend's pinned version.
  The locked configuration, sanitizer settings, limits and export palette move
  to a workspace package, `@asterism/diagram-policy`, which the frontend and the
  backend renderer both read.
- **Printed colors.** Exports use a fixed light palette (the default Atlas
  colors), not the person's theme, so a document looks the same for everyone.
- **Bounded.** At most 30 diagrams per export, an 8 second limit for each and a
  60 second limit for the whole export. Rendering shares the fetch tool's
  browser pool and semaphore so it can't starve it or launch more browsers.
  Anything over a limit, invalid or failed exports as code with a short
  "Diagram not drawn" note.
- **Accessible.** The picture's alt text is the diagram's `accTitle` and
  `accDescr` (DOCX picture description, PDF alt text), or "Diagram: <type>".
- **No new stored data.** Diagrams are drawn at export time and not cached in
  the database. Save to Files stores the exported DOCX/PDF as today.

## User stories

Suggested order: US-105.1 → 105.2 → 105.3.

### US-105.1: ADR and a shared diagram configuration

- [x] Write [ADR-0082](../adr/0082-diagrams-in-canvas-exports.md)
      (server-side drawing, isolation, limits, palette, the shared policy).
- [x] `packages/diagram-policy`: `policy.json` (the locked mermaid
      configuration, sanitizer settings and limits) and `print-theme.json`
      (export theme variables from the light Atlas palette). `policy.ts` and
      `diagram.ts` read it; `policy.ts` deep-freezes it and refuses to load
      unless mermaid stays strict without HTML labels. Frontend tests check the
      viewer draws and sanitizes with it unchanged, and that `print-theme.json`
      matches `diagramThemeVariables` for Atlas.
- [x] The image installs the package and copies it to the runtime stage.
      `check:image` checks, as the runtime user, that the policy, print theme,
      `mermaid.min.js` and `purify.min.js` are readable and that mermaid is the
      pinned version (`diagramAssetProblems`, with a unit test). No separate
      bundle copy was needed: the image already ships them for the app.

### US-105.2: A server-side diagram renderer

- [x] The fetch tool's browser pool moved, unchanged, to
      `asterism/common/headless_browser.py`; the fetch tool, the renderer and app
      shutdown use it. The fetch tool's real-browser tests pass.
- [x] The SVG sanitizer moved into the shared package (`sanitize-svg.js`); the
      app's viewer calls it, and the renderer's page loads the same file.
- [x] `draw_diagrams` / `draw_diagram` in `domains/canvas/diagrams.py`: an
      offline context with every request aborted and counted, the bundles and
      sanitizer as inline scripts, the shared configuration and print theme, the
      per-diagram time limit and a batch deadline, and a PNG with its name and
      description.
- [x] Tests (`test_canvas_diagrams.py`, real Chromium, skipped without it or
      the frontend's packages): a flowchart draws as a named 2× PNG; invalid and
      blank sources aren't drawn and the rest are; the app's hostile sources
      draw inertly or are refused, with zero requests; a hanging diagram costs
      only its page; the deadline holds; the pool is shared; a loosened policy
      is refused.
- [x] `check:image` draws a diagram inside the built image as the runtime
      user, since CI's backend job has neither Chromium nor the bundles.

### US-105.3: Diagrams in DOCX, PDF, ZIP and Save to Files

- [ ] `markdown_docx` and `markdown_pdf` embed the drawn PNG for each mermaid
      fence, with alt text, scaled to the page width; other fences stay code.
- [ ] Per-export limits (30 diagrams, 60 seconds); over the limit or failed,
      the fence exports as code with "Diagram not drawn".
- [ ] The ZIP export and Save to Files get diagrams through the same path.
- [ ] Tests: a canvas with a diagram exports DOCX and PDF containing an image
      with the right alt text; markdown and text keep the source; limits and
      failures fall back to code. Update the canvas guide page and release
      notes (Behavior; Image, if the bundle adds size).
