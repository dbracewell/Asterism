# EPIC-104: Rich content and test cleanup

Status: proposed (2026-11-25). Source: user request (2026-11-25), from
follow-ups found in [EPIC-103](EPIC-103-MERMAID-DIAGRAMS.md): a flaky
comparison test and repeated region names in rendered markdown.

## Objective

Full isolated E2E runs fail only for real regressions, and rendered markdown
stops adding a landmark for every code block, table, math expression and
diagram.

Out of scope: the macOS-only `delegation-summary` screenshot baselines, which CI
already skips.

## Where things stand (verified 2026-11-25)

- **`e2e/chat-comparison.spec.ts:232`** ("compares an answer with another model
  and continues from it") fails some of the time at 1280px and 390px: axe reports
  "Continue from Beta" at 4.33:1 (`#6c748d` on `#f5f7fb`). The axe check runs
  right after `mock.finish()`, while that button changes state, so it catches
  the colour mid-transition. It fails on pre-epic `main` too (d16d4f10: 1 of 8
  repeats), and 3–4 of 8 since EPIC-103, probably because of timing; the samples
  are small.
- **Scrollable regions.** `MarkdownViewer` wraps every table (`index.tsx:116`),
  display math span, code block (`code-block.tsx:69`) and diagram in
  `role="region"` with `tabIndex={0}`, so wide content scrolls by keyboard. Each is
  a landmark named "Scrollable table", "Scrollable math", "Scrollable code" or
  "Scrollable diagram: <name>". A reply with two code blocks fails axe's
  `landmark-unique`, and screen-reader landmark lists fill with them.
  `e2e/markdown-diagrams.spec.ts` skips `landmark-unique` for this reason. About
  13 tests find these regions by role and name.

## Decisions

- **Settle before checking.** The comparison spec waits for the button's final
  state (enabled, and no running animations on it) before axe runs. The fix is
  in the test, not the button, unless the settled colour itself fails.
- **Groups, not landmarks.** Scroll containers in rendered content become
  `role="group"` with the same keyboard focus and a short name that says what
  they hold: "Code: python", "Table", "Math", "Diagram: <name>". Groups aren't
  landmarks, so repeated names are allowed and landmark lists stay for the page's
  own structure. Pages and panels keep their existing landmarks.

## User stories

Suggested order: US-104.1 → 104.2.

### US-104.1: Settle the comparison test

- [ ] Find the transition (disabled → enabled, or the column's state change)
      and make the spec wait for it to finish before the axe check.
- [ ] Confirm the settled button meets 4.5:1 in the tested themes; fix the
      colour only if it doesn't.
- [ ] Repeat the spec 20 times at both widths with no failures.

### US-104.2: Scroll containers as groups

- [ ] Change the table, math, code and diagram scroll containers to
      `role="group"` with names that describe the content ("Code: python",
      "Table", "Math", "Diagram: <name>"), keeping `tabIndex={0}`.
- [ ] Update the tests that find them by role and name, and remove the
      `landmark-unique` skip in `markdown-diagrams.spec.ts`.
- [ ] An axe check over a reply with several code blocks, tables and diagrams
      passes with every rule on.
- [ ] Update the layout rules in
      [frontend](../architecture/frontend.md#layout-and-scrolling-rules) and
      [markdown-content.md](../architecture/markdown-content.md).
