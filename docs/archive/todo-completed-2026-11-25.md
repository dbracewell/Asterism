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
