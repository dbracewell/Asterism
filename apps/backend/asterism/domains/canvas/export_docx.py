"""Canvas export to Word (.docx)."""

import io
from typing import TYPE_CHECKING

from markdown_it.token import Token

if TYPE_CHECKING:
    pass
from .export_markdown import (
    _CSS_PX_PER_INCH,
    DIAGRAM_NOT_DRAWN,
    Diagrams,
    ExportImage,
    Images,
    _fit,
    _image_id,
    _markdown,
    diagram_alt_text,
    image_description,
    image_note,
    is_mermaid,
)

# Page widths the pictures are fitted to: DOCX's default Letter page with 1 inch
# margins, and the PDF's A4 page with 18 mm margins.
_DOCX_TEXT_WIDTH_INCHES = 6.5


# The narrowest a picture in a table cell gets, however many columns.
_DOCX_MIN_PICTURE_INCHES = 0.25


# Tallest picture, so a portrait image leaves room for the text around it.
_DOCX_MAX_IMAGE_HEIGHT_INCHES = 8.0


def markdown_docx(title: str, content: str, diagrams: Diagrams | None = None, images: Images | None = None) -> bytes:
    from docx import Document
    from docx.shared import Inches, Pt

    document = Document()
    document.core_properties.title = title
    tokens = _markdown(images=True).parse(content)
    pictures = images or {}
    lists: list[str] = []
    quotes = 0
    pending = None  # A list item's paragraph, waiting for its first text.
    paragraph = None
    table: list[list[Token]] | None = None

    def body_paragraph():
        return document.add_paragraph(style="Quote" if quotes else None)

    def code(text: str) -> None:
        run = document.add_paragraph().add_run(text.rstrip("\n"))
        run.font.name = "Courier New"
        run.font.size = Pt(9)

    def diagram(token: Token) -> None:
        drawn = (diagrams or {}).get(token.content)
        if drawn is None:
            document.add_paragraph().add_run(DIAGRAM_NOT_DRAWN).italic = True
            code(token.content)
            return
        inches = min(drawn.width / _CSS_PX_PER_INCH, _DOCX_TEXT_WIDTH_INCHES)
        document.add_picture(io.BytesIO(drawn.png), width=Inches(inches))
        # The picture's alternative text, read by screen readers and Word.
        properties = document.inline_shapes[-1]._inline.docPr
        properties.set("title", drawn.label)
        properties.set("descr", diagram_alt_text(drawn))

    for token in tokens:
        kind = token.type
        if kind == "heading_open":
            paragraph = document.add_heading(level=min(int(token.tag[1]), 9))
        elif kind in ("bullet_list_open", "ordered_list_open"):
            lists.append("List Number" if kind == "ordered_list_open" else "List Bullet")
        elif kind in ("bullet_list_close", "ordered_list_close"):
            lists.pop()
        elif kind == "list_item_open":
            depth = min(len(lists), 3)
            pending = document.add_paragraph(style=lists[-1] + (f" {depth}" if depth > 1 else ""))
        elif kind == "paragraph_open":
            if table is not None:
                continue
            paragraph, pending = (pending, None) if pending is not None else (body_paragraph(), None)
        elif kind == "blockquote_open":
            quotes += 1
        elif kind == "blockquote_close":
            quotes -= 1
        elif diagrams is not None and is_mermaid(token):
            diagram(token)
        elif kind in ("fence", "code_block"):
            code(token.content)
        elif kind == "hr":
            document.add_paragraph("—" * 3)
        elif kind == "table_open":
            table = []
        elif kind == "tr_open" and table is not None:
            table.append([])
        elif kind == "inline" and table is not None:
            table[-1].append(token)
        elif kind == "table_close" and table is not None:
            columns = max((len(row) for row in table), default=0)
            if columns:
                grid = document.add_table(rows=len(table), cols=columns)
                grid.style = "Table Grid"
                # Columns share the text width; leave room for the cell margins. Many
                # columns still leave a picture a small positive width (US-117.3).
                width = max(_DOCX_TEXT_WIDTH_INCHES / columns - 0.15, _DOCX_MIN_PICTURE_INCHES)
                for r, row in enumerate(table):
                    for c, cell_token in enumerate(row):
                        paragraph = grid.cell(r, c).paragraphs[0]
                        _docx_inline(paragraph, cell_token.children or [], pictures, max_width=width)
                        if r == 0:
                            for run in paragraph.runs:
                                run.bold = True
            table = None
        elif kind == "inline":
            target = paragraph or pending or body_paragraph()
            _docx_inline(target, token.children or [], pictures)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _docx_picture(paragraph, image: ExportImage, alt: str, max_width: float = _DOCX_TEXT_WIDTH_INCHES) -> None:
    from docx.shared import Inches

    inches = _fit(image, max_width, _DOCX_MAX_IMAGE_HEIGHT_INCHES, 1 / _CSS_PX_PER_INCH)
    shape = paragraph.add_run().add_picture(io.BytesIO(image.png), width=Inches(inches))
    properties = shape._inline.docPr
    properties.set("title", image.name)
    properties.set("descr", image_description(alt, image))


def _docx_inline(paragraph, children: list[Token], images: Images, max_width: float = _DOCX_TEXT_WIDTH_INCHES) -> None:
    bold = italic = False
    link: str | None = None
    for child in children:
        kind = child.type
        if kind == "strong_open":
            bold = True
        elif kind == "strong_close":
            bold = False
        elif kind == "em_open":
            italic = True
        elif kind == "em_close":
            italic = False
        elif kind == "link_open":
            # A chat file's id means nothing in the file; keep only the label.
            href = str(child.attrs.get("href") or "")
            link = None if href.startswith("asterism-file:") else href
        elif kind == "link_close":
            if link:
                paragraph.add_run(f" ({link})")
            link = None
        elif kind in ("text", "code_inline"):
            run = paragraph.add_run(child.content)
            run.bold, run.italic = bold or None, italic or None
            if link:
                run.underline = True
            if kind == "code_inline":
                run.font.name = "Courier New"
        elif kind == "image":
            file_id = _image_id(child)
            image = images.get(file_id) if file_id else None
            if image is not None:
                _docx_picture(paragraph, image, child.content, max_width)
            else:
                paragraph.add_run(image_note(child.content)).italic = True
        elif kind == "softbreak":
            paragraph.add_run(" ")
        elif kind == "hardbreak":
            paragraph.add_run().add_break()
