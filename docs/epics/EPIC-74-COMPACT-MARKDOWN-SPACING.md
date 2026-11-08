# EPIC-74: Compact Markdown spacing in chat

Status: complete (US-74.1 confirmed and merged 2026-11-08). Source: user request (2026-11-08), with a screenshot of a news
summary where each heading and list is separated by large gaps.

## Objective

Assistant Markdown has too much space between headings, lists and list items.
The `prose` utility in `apps/frontend/src/app/globals.css` gives every `p`,
`ul`, `ol` and heading the same `mb-5`, and loose lists (items separated by blank
lines) add paragraph margins inside each item on top of that.

## US-74.1: Tighten Markdown rhythm

As a user, I want chat answers to read compactly.

Estimate: 0.5 day. Dependencies: none.

Acceptance: headings have more space above than below and sit close to their
content; lists that follow a heading or paragraph have a small gap; paragraphs
inside list items add no extra margin; loose and tight lists look about the same.
Applies to every `MarkdownViewer` (chat, study, help) and stays readable in all
themes. Code blocks, tables and math keep their spacing.

- [x] Rework the `prose` margin rules (heading top/bottom, `li > p`, list after heading).
- [x] Add a visual/E2E check with a fixture like the screenshot (headings, loose lists, nested lists).

### Implementation notes

The typography plugin emits its own `prose` rules after our `@utility prose`
block at the same specificity, so earlier overrides only appeared to work where
values coincided (`mb-5` = `1.25em`); the `li` override never applied. Spacing
rules now sit under `&.prose` (`.prose.prose`) so they outrank the plugin.
Rhythm: blocks `mb-4`; h1/h2 `mt-7 mb-3`; h3–h6 `mt-6 mb-2`; a subheading right
under a heading `mt-0`; a paragraph followed by a list `mb-2`; list items `mb-1`
with `li > p` margins removed and nested lists `mt-1`. Covered by
`e2e/prose-spacing.spec.ts` on the `/e2e/prose` harness ("Compact prose").
