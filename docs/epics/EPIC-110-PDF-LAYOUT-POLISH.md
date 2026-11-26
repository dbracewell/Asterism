# EPIC-110: PDF layout polish

Status: in progress (2026-11-26). Source: user request (2026-11-26), from the
limits found in [EPIC-109](EPIC-109-PICTURES-IN-NESTED-PDF-BLOCKS.md).

## Objective

A canvas document's PDF download keeps the formatting models usually write:
bold and italics in table cells, code blocks lined up under the list item they
belong to, and quotes that look like quotes. Word, Markdown, text and ZIP
downloads are unchanged.

Out of scope: page layout beyond these three blocks (no syntax highlighting, no
table styling options, no page headers or footers).

## Where things stand (verified 2026-11-26)

- `_pdf_cell` (`domains/canvas/exports.py`) writes any cell that is not a
  single picture as plain text, because fpdf2 2.9.0 refuses a `<td>` holding
  more than one formatted run ("Unsupported nested HTML tags inside <td>").
  Bold, italics, code and link text all print as plain text.
- A fenced or indented code block inside a list item starts at the page
  margin; the paragraph after it returns to the item's indent (US-109.1).
- A quote is greyed text at the margin, with no indent or bar.

## Stories

### US-110.1: Bold and italics in PDF table cells

As a person downloading a canvas as PDF, I want bold and italic text in a
table to stay bold and italic, so tables read like they do in the canvas.

- [x] A cell's bold and italic runs print bold and italic; text that looks like
      formatting marks prints as written.
- [x] Code and link text in a cell print as plain text (link targets stay out).
- [x] Cells that are one picture, and the notes for other pictures, are
      unchanged from US-109.3.
- [x] Tests, ADR-0083 note, user guide and release note.

### US-110.2: Code blocks under list items in PDF

As a person downloading a canvas as PDF, I want a code block under a numbered
step to line up with the step's text, so it's clear which step it belongs to.

- [ ] A fenced or indented code block in a list item starts at the item's
      indent, at every nesting level, and long lines still wrap inside the page.
- [ ] Top-level code blocks are unchanged.
- [ ] Tests, guide and release note.

### US-110.3: Quotes that look like quotes in PDF

As a person downloading a canvas as PDF, I want quotes indented with a bar at
the left, so a quoted passage stands out from the text around it.

- [ ] A quote is indented and has a thin bar at the left for its full height,
      including across a page break; nested quotes indent further.
- [ ] Lists, pictures and diagrams inside a quote line up with the quote's text.
- [ ] Tests, guide and release note.
