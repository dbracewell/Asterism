# Completed checklist: 2026-11-25

## Mermaid diagrams

EPIC-103 is complete: every story was confirmed and merged on 2026-11-25 through pull requests #117 to #120. Taking the guide screenshot in US-103.4 found three rendering faults the tests hadn't (words split by mermaid's 120 px wrap, half-transparent edge labels, diagrams clipped at the column edge), fixed in the same story.

### [EPIC-103: Mermaid diagrams in markdown](../epics/EPIC-103-MERMAID-DIAGRAMS.md)

Source: user request (2026-11-25). [EPIC-103](../epics/EPIC-103-MERMAID-DIAGRAMS.md): render ` ```mermaid ` blocks as diagrams everywhere markdown is shown, and steer the agent to mermaid for labelled diagrams. Suggested order: US-103.1 → 103.2 → 103.3 → 103.4. Work one story at a time.

- [x] US-103.1: ADR and safe rendering (merged 2026-11-25, PR #117)
  - [x] ADR-0081 (rendering not a capability, untrusted-source config, sanitizing, lazy load, finished-block rule, fallback)
  - [x] Exact-pinned `mermaid` and `dompurify`; no `eval` in production; chunk loads only with a diagram
  - [x] Fixed `markdownMermaidConfig` in `policy.ts` and `MermaidBlock` for `language-mermaid`; sanitize the SVG
  - [x] Draw only closed fences; fall back to `CodeBlock` on errors, limits, timeouts and load failures
  - [x] Unit tests (draws, inert labels, fallbacks, unclosed fence, config not overridable)
  - [x] `/e2e/markdown` harness cases and a Playwright spec (no CSP violations)
- [x] US-103.2: The diagram block (merged 2026-11-25, PR #118)
  - [x] Header: Diagram/Code toggle, Copy source, Expand dialog, Download SVG/PNG
  - [x] Keyboard-scrollable region; `role="img"` named from `accTitle`/`accDescr`
  - [x] Theme variables from app tokens; redraw on theme change; theme-contrast harness
  - [x] Layout at 320px, canvas panel, Study notes and the guide
  - [x] Tests (toggle, copy, expand, accessible name, theme redraw)
- [x] US-103.3: Agent guidance (merged 2026-11-25, PR #119)
  - [x] `DIAGRAM_GUIDANCE` in `build_runtime_prompt`
  - [x] Narrow `IMAGE_GUIDANCE` to pictures; labelled diagrams go to mermaid
  - [x] Mention diagrams in `CANVAS_GUIDANCE`
  - [x] Prompt composition tests
- [x] US-103.4: Documentation and release (merged 2026-11-25, PR #120)
  - [x] Guide page `02-chatting/diagrams.md` with a screenshot; link from `creating-images.md`
  - [x] Architecture and security docs; `pnpm docs:check`
  - [x] Release notes (Behavior)
  - [x] Full isolated E2E suite before pushing

## Rich content and test cleanup

EPIC-104 is complete: both stories were confirmed and merged on 2026-11-25 (pull requests #121 and #122). Two intermittent E2E failures turned out to be axe scans during fades and now wait for animations to settle; rich-content scroll areas are named groups instead of landmarks, and task-list checkboxes are named.

### [EPIC-104: Rich content and test cleanup](../epics/EPIC-104-RICH-CONTENT-TEST-CLEANUP.md)

Source: user request (2026-11-25), follow-ups from EPIC-103. [EPIC-104](../epics/EPIC-104-RICH-CONTENT-TEST-CLEANUP.md). Suggested order: US-104.1 → 104.2.

- [x] US-104.1: Settle the comparison test (merged 2026-11-25, PR #121)
  - [x] Wait for the "Continue from Beta" transition before the axe check
  - [x] Confirm the settled button meets 4.5:1; fix the colour only if not
  - [x] Repeat the spec 20 times at both widths with no failures
- [x] US-104.2: Scroll containers as groups (merged 2026-11-25, PR #122)
  - [x] Table, math, code and diagram scroll containers become named `role="group"`s
  - [x] Update tests; remove the `landmark-unique` skip
  - [x] Axe passes with every rule over several code blocks, tables and diagrams
  - [x] Update the frontend layout rules and markdown-content.md

## Diagrams in canvas exports

EPIC-105 is complete: every story was confirmed and merged on 2026-11-25 through pull requests #123 to #125. Canvas Word and PDF downloads show mermaid diagrams as pictures with alt text, drawn on the server in the shared headless Chromium with the same policy, bundles and sanitizer as the app.

### [EPIC-105: Diagrams in canvas exports](../epics/EPIC-105-DIAGRAMS-IN-CANVAS-EXPORTS.md)

Source: user request (2026-11-25), the EPIC-103 follow-up. [EPIC-105](../epics/EPIC-105-DIAGRAMS-IN-CANVAS-EXPORTS.md). Suggested order: US-105.1 → 105.2 → 105.3.

- [x] US-105.1: ADR and a shared diagram configuration (merged 2026-11-25, PR #123)
  - [x] ADR (server-side drawing, isolation, limits, palette)
  - [x] Locked mermaid configuration and sanitizer settings in a shared JSON file read by `policy.ts`
  - [x] Mermaid bundle and shared configuration copied into the image; `check:image` verifies them
- [x] US-105.2: A server-side diagram renderer (merged 2026-11-25, PR #124)
  - [x] Share the fetch tool's browser pool through a small module
  - [x] `render_diagram`: aborted requests, static page, shared config, sanitizer, time limit, PNG
  - [x] Tests: draws; hostile source inert with zero requests; invalid and slow return None; pool shared
- [x] US-105.3: Diagrams in DOCX, PDF, ZIP and Save to Files (merged 2026-11-25, PR #125)
  - [x] Embed drawn PNGs with alt text in DOCX and PDF; other fences stay code
  - [x] Per-export limits; failures export as code with "Diagram not drawn"
  - [x] Save to Files uses the same path; the ZIP and Download my data keep the Markdown source
  - [x] Tests, canvas guide page and release notes

## Screenshot baselines

EPIC-106 is complete: its one story was confirmed and merged on 2026-11-25 through pull request #126. The `delegation-summary` baselines were refreshed after the Playwright 1.65.1 update (icon anti-aliasing only), `pnpm test:e2e:screenshots` runs every screenshot spec, and the Dependabot review steps say to run it when Playwright moves.

### [EPIC-106: Screenshot baselines](../epics/EPIC-106-SCREENSHOT-BASELINES.md)

Source: user request (2026-11-25). [EPIC-106](../epics/EPIC-106-SCREENSHOT-BASELINES.md).

- [x] US-106.1: Refresh the baselines and add the review step (merged 2026-11-25, PR #126)
  - [x] Regenerate the six `delegation-summary` baselines after checking the differences
  - [x] `test:e2e:screenshots` runs the five screenshot specs
  - [x] Review step in `docs/development.md` and the frontend testing docs
  - [x] Full isolated E2E run on macOS with no screenshot failures

## Images in the canvas

EPIC-107 is complete: every story was confirmed and merged on 2026-11-25 through pull requests #128 to #130. Pictures from a chat show in its canvas documents, the agent is told it can put them there, and Word, PDF, Markdown, text and ZIP downloads carry them or their descriptions (ADR-0083).

### [EPIC-107: Images in the canvas](../epics/EPIC-107-IMAGES-IN-CANVAS.md)

Source: user request (2026-11-25). [EPIC-107](../epics/EPIC-107-IMAGES-IN-CANVAS.md). Suggested order: US-107.1 → 107.2 → 107.3.

- [x] US-107.1: Show chat images in the canvas preview (merged 2026-11-25, PR #128)
  - [x] ADR-0083: read-time resolution, scope rule and limits
  - [x] `CanvasVersion.inline_files` resolved against the live chat scope; regenerate the client
  - [x] The canvas preview provides `InlineFilesContext`
  - [x] Backend, frontend and E2E tests
  - [x] Canvas guide page, ADR-0063 cross-reference, release notes
- [x] US-107.2: Tell the agent it can put images in a canvas (merged 2026-11-25, PR #129)
  - [x] `CANVAS_GUIDANCE` names the image Markdown; guidance test
  - [x] `canvas_read` and `canvas_update` keep references unchanged
  - [x] Check "make an image, then a canvas document using it" in the running app
- [x] US-107.3: Images in canvas downloads (merged 2026-11-25, PR #130)
  - [x] DOCX and PDF embed in-scope raster images with alt text
  - [x] Markdown and text use the description; the chat ZIP includes `images/`
  - [x] Save to Files uses the same path; Download my data keeps the stored text
  - [x] Tests, ADR-0083, canvas guide page, release notes

## Diagrams that real models draw

EPIC-108 is complete: both stories were confirmed and merged through pull requests #132 (2026-11-25) and #133 (2026-11-26). Diagrams draw and keep their names whether a model writes the accessibility lines before or after the type line, and `scripts/evaluate_diagrams.py` checks the diagram guidance on any OpenAI-compatible model.

### [EPIC-108: Diagrams that real models draw](../epics/EPIC-108-DIAGRAMS-FROM-REAL-MODELS.md)

Source: user request (2026-11-25), checking the diagram guidance on real models. [EPIC-108](../epics/EPIC-108-DIAGRAMS-FROM-REAL-MODELS.md). Suggested order: US-108.1 → 108.2.

- [x] US-108.1: Accessibility lines in any order (merged 2026-11-25, PR #132)
  - [x] Shared `prepareDiagramSource`, used by the app and exports; `check:image` covers it
  - [x] Prepared names for untitled SVGs; no `-v2` in type names
  - [x] Guidance: type line first, example, mind maps
  - [x] Unit, E2E and real-renderer tests
  - [x] ADR-0081, ADR-0082, package README, release notes
- [x] US-108.2: A reusable check on real models (merged 2026-11-26, PR #133)
  - [x] `scripts/evaluate_diagrams.py`: seven fixed prompts, drawn with the export renderer, table and JSON
  - [x] Scorer unit tests; backend README
  - [x] Ran on the local model (21 of 21 after the mind-map guidance fix); results in the epic
