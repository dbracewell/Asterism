# Completed checklist: 2026-11-26

## Pictures in lists, quotes and tables in exports

EPIC-109 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #136 to #138. Canvas PDF downloads keep loose lists' numbers and draw chat pictures and diagrams in list items, quotes and table cells, with alt text; Word draws pictures in table cells. US-109.3 also fixed PDF downloads failing on a table cell with bold, code or a link (ADR-0083).

### [EPIC-109: Pictures in lists, quotes and tables in exports](../epics/EPIC-109-PICTURES-IN-NESTED-PDF-BLOCKS.md)

Source: user request (2026-11-26), PDF downloads showing a note instead of a picture under a step. [EPIC-109](../epics/EPIC-109-PICTURES-IN-NESTED-PDF-BLOCKS.md). Suggested order: US-109.1 → 109.2 → 109.3.

- [x] US-109.1: Loose lists keep their numbers and bullets in PDF (merged 2026-11-26, PR #136)
  - [x] Markers and indent for items whose text is in paragraphs, at each level
  - [x] Tight lists, quotes and headings unchanged
  - [x] Tests from text extracted from the PDF; release notes
- [x] US-109.2: Pictures in lists and quotes in PDF (merged 2026-11-26, PR #137)
  - [x] HTML renderer subclass with private `src` tokens; ADR-0083 and ADR-0082
  - [x] Images and diagrams at any list depth and in quotes, fitted to the indent, with alt text
  - [x] Unloaded images and undrawn diagrams keep their notes; other `<img>` never loads
  - [x] Tests, canvas guide page, release notes
- [x] US-109.3: Images in table cells in PDF and Word (merged 2026-11-26, PR #138)
  - [x] Spike: alt text on an fpdf2 cell image; record the choice in ADR-0083
  - [x] PDF and Word cell images with alt text, fitted to the cell; formatted PDF cells no longer fail
  - [x] Tests, canvas guide page, release notes

## PDF layout polish

EPIC-110 is complete: every story was confirmed and merged on 2026-11-26 through pull requests #140 to #142. Canvas PDF downloads keep bold and italics in table cells, line up code blocks under their list item with a gap below, and indent quotes with a bar at the left that continues across page breaks (ADR-0083).

### [EPIC-110: PDF layout polish](../epics/EPIC-110-PDF-LAYOUT-POLISH.md)

- [x] US-110.1: Bold and italics in PDF table cells
  - [x] Bold and italic runs print as such; literal marks print as written
  - [x] Code and link text print plain; link targets stay out
  - [x] Picture cells and notes unchanged
  - [x] Tests, ADR-0083 note, guide and release note
- [x] US-110.2: Code blocks under list items in PDF
  - [x] Code blocks start at the item's indent at every level and wrap inside the page
  - [x] Top-level code blocks unchanged
  - [x] Tests, guide and release note
- [x] US-110.3: Quotes that look like quotes in PDF
  - [x] Indent and a left bar for the full height, across page breaks; nested quotes further in
  - [x] Lists, pictures and diagrams in a quote line up with its text
  - [x] Tests, guide and release note
  - [x] A gap under every code block (found in US-110.2)
