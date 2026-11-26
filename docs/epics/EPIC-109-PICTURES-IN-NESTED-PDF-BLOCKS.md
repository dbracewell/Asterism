# EPIC-109: Pictures in lists, quotes and tables in exports

Status: in progress (2026-11-26); US-109.1 implemented. Source: user request (2026-11-26), the follow-up
to [EPIC-107](EPIC-107-IMAGES-IN-CANVAS.md) and
[EPIC-108](EPIC-108-DIAGRAMS-FROM-REAL-MODELS.md): models often put a diagram or
an image under a numbered step, and the PDF download shows a text note there
instead of the picture.

## Objective

A canvas document's chat images and drawn diagrams appear as pictures in its
PDF download wherever the Markdown puts them: in a list item, in a quote, or
(images only) in a table cell. Word does the same for table cells. Alt text,
the scope rule and the export limits from ADR-0082 and ADR-0083 stay the same.

Out of scope: HTML canvases, Markdown, text and ZIP downloads (they already
carry descriptions or relative links), and any layout beyond fitting a picture
to the space it is in (no wrapping text around pictures, no image captions).

## Where things stand (verified 2026-11-26)

- `markdown_pdf` (`domains/canvas/exports.py`) writes runs of HTML with fpdf2's
  `write_html` and places pictures between runs, so only top-level paragraphs
  and fences can hold one. Inside a list, quote or table, `_without_images`
  turns every image into "*Image not included: <description>*", and a mermaid
  fence stays code.
- `write_html` never receives `<img>`. fpdf2 2.9.0 would load any `src` it was
  given (a path or a URL) and takes no alt text, so the export must keep
  control of which pictures are drawn and how they are described.
- fpdf2 lets a document swap its HTML renderer (`FPDF.HTML2FPDF_CLASS`). A
  spike on 2026-11-26 drew pictures inside list items (nested too) and quotes
  from a private `src` token, with alt text, and ignored any other `src`.
  List indentation lives on the current paragraph (`_paragraph.indent`), so a
  picture can line up with its item; text after it needs that indent again.
- Loose lists (items separated by blank lines, which is how models usually
  write a step with a picture under it) already lose their numbers and bullets
  in PDF: "1. Step one\n\n   More.\n\n2. Step two" prints "Step one / More. /
  Step two". Tight lists are fine.
- Word (`markdown_docx`) already embeds images and diagrams in lists and
  quotes. Table cells are text only (`_cell_text`), so an image in a cell is
  the note.
- fpdf2 table cells take an image (`cell(img=...)`) but no alt text.

## Decisions

- **One renderer, private tokens.** The PDF export uses an `HTML2FPDF`
  subclass. It draws an `<img>` only when its `src` is a token the export
  itself wrote for a loaded image or a drawn diagram, and ignores every other
  `<img>`. Each picture gets the same title and alt text as a top-level one,
  is fitted to the width left after the indent, and keeps the 230 mm height
  limit. The top-level splitting in `markdown_pdf` is replaced by this, so
  there is one way to place a picture.
- **Unloaded stays a note.** An image that is not loaded (outside the scope,
  over a limit, SVG) and a diagram that did not draw keep today's note (and
  code for a diagram), at any depth.
- **Fix loose lists first.** Pictures under steps make loose lists, so the
  list numbering fix comes before the pictures.
- **Tables keep alt text.** A picture in a PDF table cell must carry alt text.
  If fpdf2 cannot attach it to a cell image, the cell keeps the note and the
  picture follows the table with its alt text; US-109.3 decides with a spike
  and records it in ADR-0083.

## User stories

Suggested order: US-109.1 → 109.2 → 109.3.

### US-109.1: Loose lists keep their numbers and bullets in PDF

- [x] Ordered and bullet items whose text is in paragraphs print their marker
      and indent, at each nesting level, with a following paragraph in the
      same item indented under it. Loose items render as tight ones with a
      blank line between paragraphs (`_list_paragraphs`), and a renderer
      subclass (`_export_html`) reopens text after a nested list or code
      block at the item's indent. A code block in an item still starts at the
      margin, as before.
- [x] Tight lists, quotes and headings unchanged
- [x] Tests (`test_canvas_pdf_lists.py`): text and left edges read back from
      the PDF for loose, tight, nested, quoted and code-in-item lists
- [x] Release notes (Behavior)

### US-109.2: Pictures in lists and quotes in PDF

- [ ] ADR-0083 and ADR-0082 updated: the HTML renderer subclass, private
      `src` tokens and why no other `<img>` is drawn
- [ ] Loaded images and drawn diagrams inside list items (any depth) and quotes
      draw with title and alt text, fitted to the indented width; text after a
      picture keeps its indent
- [ ] Unloaded images and undrawn diagrams keep their notes; a model-written
      `<img>` or path never loads
- [ ] Top-level pictures go through the same path, unchanged in size
- [ ] Tests (`test_canvas_image_exports.py`, `test_canvas_diagrams.py`): image
      and diagram positions and alt text read back from the PDF, nested and
      quoted; the not-included and not-drawn notes; a path or URL `src`
- [ ] Canvas guide page, release notes (Behavior)

### US-109.3: Images in table cells in PDF and Word

- [ ] Spike: alt text on an fpdf2 table cell image; record the choice in
      ADR-0083
- [ ] PDF: a loaded image in a cell draws with alt text, fitted to the cell (or
      follows the table, per the spike); other cells unchanged
- [ ] Word: a loaded image in a cell is a picture with title and description,
      fitted to the column; text around it stays
- [ ] Tests for both formats, including an unloaded image in a cell
- [ ] Canvas guide page, release notes (Behavior)
