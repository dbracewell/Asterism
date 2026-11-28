"""Canvas export to PDF: fonts, pictures, tables, quotes and the PDF renderer."""

import io
import re
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

from markdown_it.token import Token

if TYPE_CHECKING:
    pass
from .export_markdown import (
    _CSS_PX_PER_INCH,
    DIAGRAM_NOT_DRAWN,
    Diagrams,
    ExportImage,
    Images,
    _image_id,
    _markdown,
    diagram_alt_text,
    image_description,
    image_note,
    is_mermaid,
)

_PDF_TEXT_WIDTH_MM = 210 - 2 * 18


_PDF_MAX_IMAGE_HEIGHT_MM = 230.0


# Unicode fonts for PDF: Debian's fonts-dejavu-core in the image, then macOS.
FONT_DIRS = ("/usr/share/fonts/truetype/dejavu", "/System/Library/Fonts/Supplemental")


FONTS = {
    "sans": ("DejaVuSans.ttf", "Arial Unicode.ttf"),
    "sans-bold": ("DejaVuSans-Bold.ttf",),
    "mono": ("DejaVuSansMono.ttf",),
    "mono-bold": ("DejaVuSansMono-Bold.ttf",),
}


# fpdf2 writes a table cell as one run, formatted with its Markdown markers.
# The export's markers are control characters (the core fonts take Latin-1
# only), removed from the cell's own text, so nothing a document says is read
# as formatting (``_export_pdf``).
_CELL_BOLD, _CELL_ITALIC = "\x01\x01", "\x02\x02"
_CELL_UNUSED = ("\x03\x03", "\x04\x04")  # Strikethrough and underline.


_CELL_ESCAPE = "\x05"


_CELL_PRIVATE = re.compile("[\x01-\x05]")


def _cell_text(token: Token, *, heading: bool = False) -> str:
    """A table cell's text for PDF, with bold and italics as fpdf2 markers, code
    and link labels as plain text and each image as its note. A heading cell is
    bold already, so it gets no bold markers."""
    parts = []
    for child in token.children or []:
        kind = child.type
        if kind in ("strong_open", "strong_close") and not heading:
            parts.append(_CELL_BOLD)
        elif kind in ("em_open", "em_close"):
            parts.append(_CELL_ITALIC)
        elif kind == "image":
            parts.append(f"[{image_note(child.content)}]")
        elif kind in ("text", "code_inline"):
            parts.append(_CELL_PRIVATE.sub("", child.content))
        elif kind in ("softbreak", "hardbreak"):
            parts.append(" ")
    return "".join(parts)


class _QuoteBars(Protocol):
    """What the export's renderer uses of its document for quote bars."""

    y: float
    l_margin: float
    quote_bars: list[list[float]]

    def quote_bar(self, x: float, top: float, bottom: float) -> None: ...


_PDF_QUOTE_INDENT_MM = 6


_PDF_QUOTE_BAR_OFFSET_MM = 1.5  # From the quote's outer edge.


_PDF_QUOTE_BAR_WIDTH_MM = 0.8


_PDF_QUOTE_BAR_COLOR = (190, 190, 190)


def _font(name: str) -> str | None:
    for directory in FONT_DIRS:
        for filename in FONTS[name]:
            path = Path(directory) / filename
            if path.is_file():
                return str(path)
    return None


def _pdf_styles(code_family: str) -> dict:
    """fpdf2's tag styles in plain ink (dark headings, grey quotes) and our code font."""
    from fpdf.html import DEFAULT_TAG_STYLES

    ink = {f"h{level}": "#111111" for level in range(1, 7)} | {"blockquote": "#444444"}
    styles = {tag: DEFAULT_TAG_STYLES[tag].replace(color=color) for tag, color in ink.items()}
    # <pre> is a TextStyle (font_family), <code> a FontFace (family).
    return styles | {
        # A gap under a code block, so the next list item doesn't touch it.
        "pre": DEFAULT_TAG_STYLES["pre"].replace(font_family=code_family, b_margin=3),
        "code": DEFAULT_TAG_STYLES["code"].replace(family=code_family),
    }


def _note_tokens(alt: str) -> list[Token]:
    return [
        Token("em_open", "em", 1),
        Token("text", "", 0, content=image_note(alt)),
        Token("em_close", "em", -1),
    ]


@dataclass(frozen=True)
class _PdfPicture:
    """A loaded image or drawn diagram, drawn where its Markdown is."""

    png: bytes
    width_px: int
    height_px: int
    title: str
    alt: str
    max_height_mm: float | None

    def max_width_mm(self) -> float:
        """Its width at 96 CSS px per inch, narrowed to keep the height limit."""
        width = self.width_px * 25.4 / _CSS_PX_PER_INCH
        if self.max_height_mm is None:
            return width
        return min(width, self.max_height_mm * self.width_px / self.height_px)


class _CellImage(io.BytesIO):
    """A picture handed to an fpdf2 table cell, which draws it at the column's
    width with no alt text; ``_export_pdf`` reads these to fix both."""

    def __init__(self, picture: _PdfPicture) -> None:
        super().__init__(picture.png)
        self.picture = picture


def _note_paragraph(text: str, level: int) -> list[Token]:
    children = [Token("em_open", "em", 1), Token("text", "", 0, content=text), Token("em_close", "em", -1)]
    return [
        Token("paragraph_open", "p", 1, level=level, block=True),
        Token("inline", "", 0, level=level + 1, children=children),
        Token("paragraph_close", "p", -1, level=level, block=True),
    ]


def _pdf_pictures(
    tokens: list[Token], diagrams: Diagrams | None, images: Images
) -> tuple[list[Token], dict[str, "_PdfPicture"]]:
    """Give each loaded image and drawn diagram, at any depth, a private ``src``
    that only the renderer (``_export_html``) draws. Every other image becomes
    its note and a chat file link its label, so no other ``<img>`` is written.
    Table cells follow ``_pdf_cell``. Diagrams draw only when ``diagrams`` is
    given; an undrawn one is its note and the code."""
    key = f"asterism-export-{uuid.uuid4().hex}:"
    pictures: dict[str, _PdfPicture] = {}

    def add(picture: _PdfPicture) -> Token:
        src = f"{key}{len(pictures)}"
        pictures[src] = picture
        return Token("image", "img", 0, attrs={"src": src, "alt": ""}, children=[])

    out: list[Token] = []
    tables: list[Token] = []
    heading = False  # Whether the open cell is a heading cell.
    for token in tokens:
        if token.type == "table_open":
            tables.append(token)
        elif token.type == "table_close":
            tables.pop()
        elif token.type in ("th_open", "td_open"):
            heading = token.type == "th_open"
        if diagrams is not None and is_mermaid(token):
            drawn = diagrams.get(token.content)
            if drawn is None:
                out.extend([*_note_paragraph(DIAGRAM_NOT_DRAWN, token.level), token])
                continue
            paragraph = _note_paragraph("", token.level)
            paragraph[1].children = [
                add(_PdfPicture(drawn.png, drawn.width, drawn.height, drawn.label, diagram_alt_text(drawn), None))
            ]
            out.extend(paragraph)
            continue
        if token.type == "inline" and tables:
            token.children = _pdf_cell(token, images, add, heading=heading)
            if token.children[0].type == "image":
                tables[-1].attrSet("cellpadding", "1")  # 1 mm, so pictures don't touch.
        elif token.children:
            children: list[Token] = []
            depth = 0  # Inside a dropped chat file link.
            for child in token.children:
                if child.type == "image":
                    file_id = _image_id(child)
                    image = images.get(file_id) if file_id else None
                    if image is None:
                        children.extend(_note_tokens(child.content))
                    else:
                        children.append(add(_image_picture(image, child.content)))
                elif child.type == "link_open" and (
                    depth or str(child.attrs.get("href") or "").startswith("asterism-file:")
                ):
                    depth += 1
                elif child.type == "link_close" and depth:
                    depth -= 1
                else:
                    children.append(child)
            token.children = children
        out.append(token)
    return out, pictures


def _image_picture(image: ExportImage, alt: str) -> _PdfPicture:
    return _PdfPicture(
        image.png, image.width, image.height, image.name, image_description(alt, image), _PDF_MAX_IMAGE_HEIGHT_MM
    )


def _pdf_cell(
    token: Token, images: Images, add: Callable[[_PdfPicture], Token], *, heading: bool = False
) -> list[Token]:
    """A table cell's content. fpdf2 holds one run of text or one image per
    cell, and refuses nested HTML tags, so a cell that is one loaded image draws
    it, and any other cell is one run of text (``_cell_text``) with notes for
    images, as in DOCX."""
    children = token.children or []
    found = [child for child in children if child.type == "image"]
    if len(found) == 1 and _only_pictures(children):
        file_id = _image_id(found[0])
        image = images.get(file_id) if file_id else None
        if image is not None:
            return [add(_image_picture(image, found[0].content))]
    return [Token("text", "", 0, content=_cell_text(token, heading=heading))]


def _list_paragraphs(tokens: list[Token]) -> list[Token]:
    """Loose list items written as tight ones, with a blank line between two of
    their paragraphs. fpdf2 drops an item's marker and indent when its text is
    in a ``<p>``, and loose items are how a step with a picture under it is
    written. Text after a nested block reopens at the item's indent
    (``_ExportHTML``)."""
    # Per open list item: its level, and the last block written directly in it.
    items: list[tuple[int, str | None]] = []
    for index, token in enumerate(tokens):
        if token.type == "list_item_open":
            items.append((token.level, None))
        elif token.type == "list_item_close":
            items.pop()
        elif not items or token.nesting == -1 or token.level != items[-1][0] + 1:
            continue
        elif token.type == "paragraph_open":
            token.hidden = tokens[index + 2].hidden = True  # And its close.
            inline = tokens[index + 1]
            kind = "picture" if _only_pictures(inline.children or []) else "paragraph"
            if kind == items[-1][1] == "paragraph":
                inline.children = [Token("hardbreak", "br", 0), Token("hardbreak", "br", 0), *(inline.children or [])]
            items[-1] = (items[-1][0], kind)
        else:
            items[-1] = (items[-1][0], token.type)
    return tokens


def _only_pictures(children: list[Token]) -> bool:
    """Whether an inline run is pictures alone, which end the text anyway."""
    blank = all(
        child.type in ("image", "softbreak", "hardbreak") or (child.type == "text" and not child.content.strip())
        for child in children
    )
    return blank and any(child.type == "image" for child in children)


@cache
def _export_html() -> type:
    """fpdf2's HTML renderer for exports. It draws an ``<img>`` only when its
    ``src`` is one of this export's pictures (``_pdf_pictures``), fitted to the
    width left after the indent, with its title and alt text, and ignores any
    other. A quote is indented, one step per level, with a bar at its left
    (``_export_pdf`` carries the bar across page breaks). A code block in a list
    item or quote starts at that block's indent, and text keeps the indent
    after a picture, a nested list or a code block."""
    from fpdf.html import HTML2FPDF

    class _ExportHTML(HTML2FPDF):
        def __init__(self, *args, pictures: Mapping[str, _PdfPicture] | None = None, **kwargs) -> None:
            self._pictures = pictures or {}
            self._resume: float | None = None  # The indent text reopens at after a picture.
            self._written = False  # Whether the current paragraph has text.
            super().__init__(*args, **kwargs)

        def _list_indent(self) -> float:
            margin = getattr(self.tag_styles["li"], "l_margin", 0)
            return (margin if isinstance(margin, (int, float)) else 0) * self.indent

        def _quote_indent(self) -> float:
            return _PDF_QUOTE_INDENT_MM * self._tags_stack.count("blockquote")

        def _item_indent(self) -> float:
            """The indent of the innermost list item or quote's text."""
            return self._list_indent() + self._quote_indent()

        def _new_paragraph(self, *args, own: bool = False, **kwargs) -> None:
            """fpdf2's paragraphs indent for lists only, and a code block not
            even for those; ours (``own``) carry their full indent."""
            self._resume, self._written = None, False
            if not own:
                extra = self._quote_indent()
                if self._tags_stack[-1:] == ["pre"] and "li" in self._tags_stack:
                    extra += self._list_indent()
                kwargs["indent"] = (kwargs.get("indent") or 0) + extra
            super()._new_paragraph(*args, **kwargs)

        def _write_paragraph(self, text: str, link: int | str | None = None) -> None:
            if text and not self._paragraph:
                if self._resume is not None:
                    self._new_paragraph(indent=self._resume, own=True)
                elif "li" in self._tags_stack or "blockquote" in self._tags_stack:
                    self._new_paragraph(indent=self._item_indent(), own=True)
            self._written = self._written or bool(text)
            super()._write_paragraph(text, link)

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            if tag == "blockquote":
                self._end_paragraph()
                margin = getattr(self.tag_styles["blockquote"], "t_margin", 0) or 0
                pdf = cast(_QuoteBars, self.pdf)
                x = pdf.l_margin + self._item_indent() + _PDF_QUOTE_BAR_OFFSET_MM
                pdf.quote_bars.append([x, pdf.y + margin])
            if tag != "img":
                super().handle_starttag(tag, attrs)
                if tag == "table" and self.table is not None:
                    # fpdf2 has no option for this here; cells carry the
                    # export's private markers (``_cell_text``).
                    self.table._markdown = True
                return
            picture = self._pictures.get(dict(attrs).get("src") or "")
            if picture is None:
                return
            if self.table_row is not None:
                if self.td_th is not None and "inserted" not in self.td_th:
                    self.table_row.cell(img=_CellImage(picture), img_fill_width=True)
                    self.td_th["inserted"] = True
                return
            in_item = "li" in self._tags_stack
            if self._paragraph is not None:
                indent = getattr(self._paragraph, "indent", 0) or 0
                if not self._written and in_item:
                    super()._write_paragraph("\u00a0")  # So the item's marker prints.
            elif self._resume is not None:
                indent = self._resume
            else:
                indent = self._item_indent()
            self._end_paragraph()
            self._draw(picture, indent)
            self._resume = indent

        def handle_endtag(self, tag: str) -> None:
            super().handle_endtag(tag)
            pdf = cast(_QuoteBars, self.pdf)
            if tag == "blockquote" and pdf.quote_bars:
                self._end_paragraph()
                x, top = pdf.quote_bars.pop()
                pdf.quote_bar(x, top, pdf.y)

        def _draw(self, picture: _PdfPicture, indent: float) -> None:
            self.pdf.ln(2)
            self.pdf.image(
                io.BytesIO(picture.png),
                x=self.pdf.l_margin + indent,
                w=min(picture.max_width_mm(), self.pdf.epw - indent),
                title=picture.title,
                alt_text=picture.alt,
            )
            self.pdf.ln(4)

    return _ExportHTML


@cache
def _export_pdf() -> type:
    """fpdf2's document with the export's HTML renderer. A table cell's picture
    (``_CellImage``) keeps its natural size within the column and gets its
    title and alt text, once: fpdf2 lays a table out twice, the first time with
    writing switched off, and marked content then would be a second, empty
    entry in the structure tree. Each open quote's bar (``quote_bars``) is drawn
    to the last line of a page that breaks inside it and restarts at the next page's
    top. Its Markdown (used only in table cells) reads
    just the export's own bold and italic markers: no links, bullets,
    escapes or other marks from the document's text."""
    import types

    from fpdf import FPDF

    never = re.compile(r"(?!)")

    class _ExportPDF(FPDF):
        HTML2FPDF_CLASS = _export_html()
        MARKDOWN_BOLD_MARKER = _CELL_BOLD
        MARKDOWN_ITALICS_MARKER = _CELL_ITALIC
        MARKDOWN_STRIKETHROUGH_MARKER, MARKDOWN_UNDERLINE_MARKER = _CELL_UNUSED
        MARKDOWN_MARKERS = (_CELL_BOLD, _CELL_ITALIC, *_CELL_UNUSED)
        MARKDOWN_ESCAPE_CHARACTER = _CELL_ESCAPE
        MARKDOWN_LINK_REGEX = never
        MARKDOWN_BULLET_REGEX = never

        def __init__(self, *args, **kwargs) -> None:
            super().__init__(*args, **kwargs)
            self.quote_bars: list[list[float]] = []  # [x, top] per open quote.

        def quote_bar(self, x: float, top: float, bottom: float) -> None:
            if bottom > top:
                with self.local_context(draw_color=_PDF_QUOTE_BAR_COLOR, line_width=_PDF_QUOTE_BAR_WIDTH_MM):
                    self.line(x, top, x, bottom)

        def add_page(self, *args, **kwargs) -> None:
            for bar in self.quote_bars:
                self.quote_bar(bar[0], bar[1], min(self.y, self.page_break_trigger))
            super().add_page(*args, **kwargs)
            for bar in self.quote_bars:
                bar[1] = self.t_margin

        def image(self, name, *args, **kwargs):
            if isinstance(name, _CellImage):
                picture = name.picture
                if kwargs.get("w"):
                    kwargs["w"] = min(kwargs["w"], picture.max_width_mm())
                if isinstance(self._out, types.MethodType):  # Not the measuring pass.
                    kwargs.setdefault("title", picture.title)
                    kwargs.setdefault("alt_text", picture.alt)
            return super().image(name, *args, **kwargs)

    return _ExportPDF


def markdown_pdf(title: str, content: str, diagrams: Diagrams | None = None, images: Images | None = None) -> bytes:
    pdf = _export_pdf()(format="A4")
    pdf.set_title(title)
    pdf.set_margins(18, 18, 18)
    pdf.add_page()
    sans, mono = _font("sans"), _font("mono")
    if sans:
        bold = _font("sans-bold") or sans
        for style, path in (("", sans), ("B", bold), ("I", sans), ("BI", bold)):
            pdf.add_font("body", style, path)
        mono = mono or sans
        mono_bold = _font("mono-bold") or mono
        for style, path in (("", mono), ("B", mono_bold), ("I", mono), ("BI", mono_bold)):
            pdf.add_font("code", style, path)
        family, code_family, text = "body", "code", content
    else:
        # Without a Unicode font the core fonts take Latin-1 only.
        family, code_family = "helvetica", "courier"
        text = content.encode("latin-1", "replace").decode("latin-1")
    pdf.set_font(family, size=11)
    markdown = _markdown(images=True)
    styles = _pdf_styles(code_family)

    tokens, pictures = _pdf_pictures(markdown.parse(text), diagrams, images or {})
    pdf.write_html(
        markdown.renderer.render(_list_paragraphs(tokens), markdown.options, {}),
        pictures=pictures,
        font_family=family,
        li_prefix_color=(0, 0, 0),
        tag_styles=styles,
        warn_on_tags_not_matching=False,
    )
    return bytes(pdf.output())
