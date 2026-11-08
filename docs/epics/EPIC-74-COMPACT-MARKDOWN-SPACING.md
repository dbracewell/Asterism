# EPIC-74: Compact Markdown spacing in chat

Status: proposed. Source: user request (2026-11-08), with a screenshot of a news
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

- [ ] Rework the `prose` margin rules (heading top/bottom, `li > p`, list after heading).
- [ ] Add a visual/E2E check with a fixture like the screenshot (headings, loose lists, nested lists).
