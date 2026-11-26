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
