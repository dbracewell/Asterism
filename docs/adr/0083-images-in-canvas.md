# ADR-0083 — Images in the canvas

Status: accepted. Read-time resolution and the canvas preview (US-107.1), the
agent guidance (US-107.2) and images in downloads (US-107.3) are implemented
(2026-11-25); the epic is complete
([EPIC-107](../epics/EPIC-107-IMAGES-IN-CANVAS.md)).

## Context

Replies embed chat files as `![description](asterism-file:<id>)` (ADR-0039),
and `generate_image` hands the agent exactly that Markdown (ADR-0064). A reply's
references are resolved when the message is saved and rechecked against the
live chat scope on every read. The viewer shows a file only through that
resolved list; the ID in the text grants nothing.

Canvas versions (ADR-0063) store only text, and their preview had no resolved
list, so every reference, including an image the same run had just made,
showed "File unavailable". Save-time resolution, as for messages, would not
cover canvas versions well: people write and restore versions too, and a
version is read long after it is written.

## Decision: resolve canvas references when a version is read

- Every `CanvasVersion` response (read, create, user save and restore) carries
  `inline_files`, resolved from its content by
  `chat.inline_files.resolve_in_live_scope`. It uses the same reference shape
  and the same bare unavailable entry as ADR-0039, and the same limit of 32
  distinct IDs per text, in order of first occurrence.
- A reference is available while the file is in the chat's **live file scope**
  (`resolve_chat_file_scope`): the chat's attachments, files produced by the
  chat's runs, and the project's files. Anything else (another chat's file, a
  library-only file, another person's file, a missing ID) is indistinguishable.
- There is no run ceiling, unlike reply resolution: canvas versions are read
  only by the chat's owner, who can already open every file in scope through
  the scoped chat-file routes, and either the owner or the agent may have
  written the text.
- Nothing is stored, so there is no schema change, and a file removed from the
  chat stops showing on the next read. The `canvas_read` tool still returns
  only the text.

## Decision: the preview uses the reply's renderer

The canvas preview provides `InlineFilesContext` with the chat ID and the
version's `inline_files`, so images, document cards and file chips behave as
they do in replies, and bytes still come only through
`GET /chat/{chat_id}/files/{file_id}`. A reference typed into unsaved edits
shows "File unavailable" until the version is saved, because the resolved list
belongs to a saved version. HTML canvases are unchanged: their sandboxed
preview loads nothing.

## Consequences

- Each version read runs one live-scope query and one file query when the
  content has references; content without references costs nothing extra.
- DOCX and PDF downloads embed them (US-107.3, below).

## Decision: the agent is told (US-107.2)

`CANVAS_GUIDANCE` says a markdown canvas can hold images and files from the
conversation as `![short description](asterism-file:<file id>)`, such as the
`embed` that `generate_image` returns, and that other ids show as unavailable.
`IMAGE_GUIDANCE` now asks the agent not to repeat generated images in its
reply, rather than never to repeat their ids, so the two don't conflict. The
canvas tools store references as written; the guidance grants nothing.

## Decision: images in downloads (US-107.3)

- **Loading.** `downloads.load_export_images` collects the
  `![…](asterism-file:<id>)` images outside code blocks and keeps those in the
  chat's live file scope. It reads them through the owner's file records and
  the file store. Limits:
  - at most 32 images per export (`MAX_EXPORT_IMAGES`);
  - at most 20 MB each, matching inline images in the app;
  - at most 40 million decoded pixels each.

  Only raster types (PNG, JPEG, GIF, WebP, BMP) load, never SVG. Pillow
  decodes each image in a worker thread and re-encodes it as PNG, using the
  first frame of an animation. Anything not loaded is left out. Logs give
  counts and file ids, never content.
- **DOCX and PDF** parse images but embed only loaded ones. The picture is
  fitted to the text width and a maximum height (8 in in DOCX, 230 mm in PDF)
  at 96 CSS px per inch. Its title is the file name and its alt text is the
  image's description, or else the file name.
  - Every other image becomes an italic "Image not included: <description>":
    a web URL, another chat's file, SVG, or a file over a limit. Nothing is
    ever fetched from an image URL.
  - DOCX embeds images anywhere text goes, table cells included (fitted to the
    column's share of the text width, with the cell's text and formatting
    around them). PDF draws them in paragraphs, list items at any depth,
    quotes and table cells (below).
  - PDF placement (EPIC-109, US-109.2). Each loaded image and drawn diagram
    gets an `<img>` whose `src` is `asterism-export-<random>:<n>`, made fresh
    for each export. The export's `HTML2FPDF` subclass (`_export_html`, set
    through `FPDF.HTML2FPDF_CLASS`) draws an `<img>` only when its `src` is in
    that export's picture map, and ignores every other one, so a path, URL or
    guessed token in the text never loads. (fpdf2 itself would load any `src`,
    and takes no alt text from HTML.) The picture goes at the current list
    indent with its title and alt text, fitted to the width left; text after it
    reopens at the same indent. Raw HTML is never parsed, so the only `<img>`
    tags are the export's own.
  - PDF table cells (US-109.3). fpdf2 2.9.0 holds one run of text or one image
    per cell, and refuses a cell with mixed formatting (bold, code, a link),
    which stopped such a PDF being made at all. So a cell that is exactly one
    loaded image draws it, and every other cell is its plain text with images
    as `[Image not included: <description>]`, as DOCX cells were before. fpdf2
    draws a cell image at the full column width with no alt text; the export's
    `FPDF` subclass (`_export_pdf`) caps it at the natural size (and the height
    limit) and adds its title and alt text. fpdf2 lays a table out twice, the
    first time with writing switched off, so the alt text is added only on the
    pass that writes, or the structure tree would hold a second, empty figure.
  - Bold and italics in PDF table cells (US-110.1). A text cell is still one
    run, written in fpdf2's table Markdown mode, which the HTML renderer has no
    option for, so `_ExportHTML` sets it on each table it makes. fpdf2's own
    markers (`**`, `__`, `--`, `~~`, `\`) and its link and bullet syntax would
    read a document's literal text as formatting, and its escape doesn't cover
    `[`. So the export's `FPDF` subclass uses control characters as markers
    (Latin-1, for the core fonts), matches no links or bullets, and
    `_cell_text` removes those characters from the cell's own text. Code and
    link labels are plain text; a heading cell gets no bold markers, since it
    is bold already.
    A table with a picture gets 1 mm cell padding so pictures don't touch.
  - A link to a chat file keeps only its label in both formats.
- **Markdown and text** downloads of a document write each image as
  `[Image not included: <description>]` and each chat file link as its label,
  outside code blocks.
- **The chat's ZIP** adds each loaded image once, as its stored file, under
  `images/` with a distinct name. Its documents link to them relatively, and
  the rest become notes.
- **Save to Files** uses the single-version path. **Download my data** passes
  no images, so it keeps the stored text exactly.
