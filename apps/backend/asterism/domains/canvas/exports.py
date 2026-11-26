"""Canvas downloads, produced on the server (ADR-0063, US-72.3).

Every export is built from one stored version. Markdown is parsed without raw
HTML, so a DOCX or PDF never embeds markup or fetches a URL found in canvas
content. An image is embedded only from bytes the caller loaded for an
``asterism-file:`` reference in the chat's scope (ADR-0083); every other image
is written as a short note.
"""

import io
import re
import uuid
import zipfile
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Literal
from urllib.parse import quote

from markdown_it import MarkdownIt
from markdown_it.token import Token

from asterism.core.exceptions import BadDataException

from .schemas import CanvasKind

if TYPE_CHECKING:
    from .diagrams import DrawnDiagram

# Drawn mermaid diagrams by fence source (ADR-0082). ``None`` (or a missing
# source) means the diagram couldn't be drawn and exports as code.
Diagrams = Mapping[str, "DrawnDiagram | None"]
DIAGRAM_NOT_DRAWN = "Diagram not drawn"
IMAGE_NOT_INCLUDED = "Image not included"
# Page widths the pictures are fitted to: DOCX's default Letter page with 1 inch
# margins, and the PDF's A4 page with 18 mm margins.
_DOCX_TEXT_WIDTH_INCHES = 6.5
_PDF_TEXT_WIDTH_MM = 210 - 2 * 18
_CSS_PX_PER_INCH = 96
# Tallest picture, so a portrait image leaves room for the text around it.
_DOCX_MAX_IMAGE_HEIGHT_INCHES = 8.0
_PDF_MAX_IMAGE_HEIGHT_MM = 230.0
_TOKEN_ID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_FILE_IMAGE = re.compile(rf"!\[([^\]\n]*)\]\(asterism-file:({_TOKEN_ID})\)")
_FILE_LINK = re.compile(rf"(?<!!)\[([^\]\n]*)\]\(asterism-file:({_TOKEN_ID})\)")
_FILE_SOURCE = re.compile(rf"^asterism-file:({_TOKEN_ID})$")


@dataclass(frozen=True)
class ExportImage:
    """A chat image loaded for an export (ADR-0083).

    ``png`` is the decoded image re-encoded as PNG, for DOCX and PDF; ``original``
    and ``extension`` are the stored file, for the ZIP. ``width`` and ``height``
    are in pixels, read as CSS pixels when the picture is sized.
    """

    png: bytes
    width: int
    height: int
    name: str
    original: bytes
    extension: str


# Images by file id; a missing id is written as a note instead.
Images = Mapping[uuid.UUID, ExportImage]

CanvasExportFormat = Literal["md", "txt", "source", "html", "docx", "pdf"]

FORMATS: dict[CanvasKind, tuple[CanvasExportFormat, ...]] = {
    "document": ("md", "txt", "docx", "pdf"),
    "code": ("source", "txt"),
    "html": ("html", "txt"),
}
"""What each kind can be downloaded as; the first is its natural file type."""

MEDIA_TYPES: dict[str, str] = {
    "md": "text/markdown; charset=utf-8",
    "txt": "text/plain; charset=utf-8",
    "source": "text/plain; charset=utf-8",
    "html": "text/html; charset=utf-8",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "zip": "application/zip",
}

SOURCE_EXTENSIONS: dict[str, str] = {
    "bash": "sh",
    "c": "c",
    "c#": "cs",
    "c++": "cpp",
    "cpp": "cpp",
    "csharp": "cs",
    "css": "css",
    "go": "go",
    "haskell": "hs",
    "html": "html",
    "java": "java",
    "javascript": "js",
    "js": "js",
    "json": "json",
    "jsx": "jsx",
    "kotlin": "kt",
    "lua": "lua",
    "markdown": "md",
    "perl": "pl",
    "php": "php",
    "python": "py",
    "r": "r",
    "ruby": "rb",
    "rust": "rs",
    "scala": "scala",
    "sh": "sh",
    "shell": "sh",
    "sql": "sql",
    "swift": "swift",
    "toml": "toml",
    "ts": "ts",
    "tsx": "tsx",
    "typescript": "ts",
    "xml": "xml",
    "yaml": "yaml",
    "yml": "yaml",
    "zsh": "sh",
}

# Unicode fonts for PDF: Debian's fonts-dejavu-core in the image, then macOS.
FONT_DIRS = ("/usr/share/fonts/truetype/dejavu", "/System/Library/Fonts/Supplemental")
FONTS = {
    "sans": ("DejaVuSans.ttf", "Arial Unicode.ttf"),
    "sans-bold": ("DejaVuSans-Bold.ttf",),
    "mono": ("DejaVuSansMono.ttf",),
    "mono-bold": ("DejaVuSansMono-Bold.ttf",),
}


@dataclass(frozen=True)
class ExportedFile:
    filename: str
    media_type: str
    content: bytes


def extension(kind: CanvasKind, language: str, export: CanvasExportFormat) -> str:
    if export == "source":
        return SOURCE_EXTENSIONS.get(language, "txt")
    return export


def file_stem(title: str) -> str:
    """A filename stem from a title: no separators, control characters or leading dots."""
    stem = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]+', " ", title)
    stem = " ".join(stem.split()).lstrip(".").strip()[:100].rstrip(". ")
    return stem or "canvas"


def content_disposition(filename: str) -> str:
    """``attachment`` with an ASCII fallback and the UTF-8 name (RFC 6266)."""
    fallback = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", filename) or "canvas"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def _markdown(*, images: bool = False) -> MarkdownIt:
    # No raw HTML: exports never carry markup. Images are parsed only for DOCX
    # and PDF, which embed loaded chat images and write a note for the rest;
    # nothing is ever fetched from an image's URL.
    markdown = MarkdownIt("commonmark", {"html": False}).enable("table")
    return markdown if images else markdown.disable("image")


def _outside_code(content: str, replace: Callable[[str], str]) -> str:
    """Apply ``replace`` to the text outside fenced and indented code blocks."""
    lines = content.splitlines(keepends=True)
    code = [False] * len(lines)
    for token in _markdown().parse(content):
        if token.type in ("fence", "code_block") and token.map:
            for line in range(*token.map):
                code[line] = True
    out: list[str] = []
    chunk: list[str] = []
    for line, is_code in zip(lines, code, strict=True):
        if is_code:
            out.append(replace("".join(chunk)))
            chunk = []
            out.append(line)
        else:
            chunk.append(line)
    out.append(replace("".join(chunk)))
    return "".join(out)


def image_references(content: str) -> list[uuid.UUID]:
    """Distinct ``![…](asterism-file:<id>)`` image ids outside code, in order."""
    found: dict[uuid.UUID, None] = {}

    def collect(text: str) -> str:
        for match in _FILE_IMAGE.finditer(text):
            found.setdefault(uuid.UUID(match.group(2)), None)
        return text

    _outside_code(content, collect)
    return list(found)


def image_description(alt: str, image: ExportImage | None = None) -> str:
    return " ".join(alt.split()) or (image.name if image else "") or "image"


def image_note(alt: str) -> str:
    return f"{IMAGE_NOT_INCLUDED}: {image_description(alt)}"


def rewrite_file_references(content: str, image: Callable[[uuid.UUID, str], str]) -> str:
    """Rewrite ``asterism-file:`` references outside code for a file read elsewhere.

    ``image(file_id, alt)`` gives each image's replacement; a link becomes its
    label, since the id means nothing outside Asterism.
    """

    def replace(text: str) -> str:
        text = _FILE_IMAGE.sub(lambda m: image(uuid.UUID(m.group(2)), m.group(1)), text)
        return _FILE_LINK.sub(lambda m: m.group(1), text)

    return _outside_code(content, replace)


def _image_id(token: Token) -> uuid.UUID | None:
    """The file id of an ``asterism-file:`` image; ``None`` for any other source."""
    match = _FILE_SOURCE.match(str(token.attrs.get("src") or ""))
    return uuid.UUID(match.group(1)) if match else None


def _fit(image: ExportImage, max_width: float, max_height: float, per_px: float) -> float:
    """The picture's width in the page's unit, within the text width and height."""
    scale = min(1.0, max_width / (image.width * per_px), max_height / (image.height * per_px))
    return image.width * per_px * scale


def is_mermaid(token: Token) -> bool:
    """A fenced block whose language is ``mermaid``."""
    words = (token.info or "").strip().split(maxsplit=1)
    return token.type == "fence" and bool(words) and words[0].lower() == "mermaid"


def mermaid_sources(content: str) -> list[str]:
    """The distinct mermaid fence sources in a markdown document, in order."""
    found: dict[str, None] = {}
    for token in _markdown().parse(content):
        if is_mermaid(token) and token.content.strip():
            found.setdefault(token.content, None)
    return list(found)


def diagram_alt_text(drawn: "DrawnDiagram") -> str:
    return f"{drawn.label}: {drawn.description}" if drawn.description else drawn.label


def export_version(
    *,
    kind: CanvasKind,
    language: str,
    title: str,
    content: str,
    export: CanvasExportFormat,
    diagrams: Diagrams | None = None,
    images: Images | None = None,
) -> ExportedFile:
    """``diagrams``, for DOCX and PDF: pictures for mermaid fences. Without it
    every fence exports as code, with no note.

    ``images``: chat images loaded for the document's references (ADR-0083).
    DOCX and PDF embed them and write a note for any other image. Given for a
    Markdown or text download of a document, references are rewritten for
    reading outside Asterism; without it the stored text is kept as it is."""
    if export not in FORMATS[kind]:
        allowed = ", ".join(FORMATS[kind])
        raise BadDataException(f"A {kind} item downloads as {allowed}")
    filename = f"{file_stem(title)}.{extension(kind, language, export)}"
    if export == "docx":
        data = markdown_docx(title, content, diagrams, images)
    elif export == "pdf":
        data = markdown_pdf(title, content, diagrams, images)
    elif kind == "document" and images is not None and export in ("md", "txt"):
        data = rewrite_file_references(content, lambda _id, alt: f"[{image_note(alt)}]").encode("utf-8")
    else:
        data = content.encode("utf-8")
    return ExportedFile(filename=filename, media_type=MEDIA_TYPES[export], content=data)


def zip_exports(files: list[ExportedFile]) -> bytes:
    """One archive; repeated names get ``(2)``, ``(3)``, … before the extension."""
    buffer = io.BytesIO()
    taken: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            stem, suffix = Path(file.filename).stem, Path(file.filename).suffix
            name, counter = file.filename, 2
            while name.lower() in taken:
                name = f"{stem} ({counter}){suffix}"
                counter += 1
            taken.add(name.lower())
            archive.writestr(name, file.content)
    return buffer.getvalue()


# --- DOCX ---------------------------------------------------------------


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
    table: list[list[str]] | None = None

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
            table[-1].append(_cell_text(token))
        elif kind == "table_close" and table is not None:
            columns = max((len(row) for row in table), default=0)
            if columns:
                grid = document.add_table(rows=len(table), cols=columns)
                grid.style = "Table Grid"
                for r, row in enumerate(table):
                    for c, text in enumerate(row):
                        cell = grid.cell(r, c)
                        cell.text = text
                        if r == 0:
                            for run in cell.paragraphs[0].runs:
                                run.bold = True
            table = None
        elif kind == "inline":
            target = paragraph or pending or body_paragraph()
            _docx_inline(target, token.children or [], pictures)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _cell_text(token: Token) -> str:
    """A table cell's text, with each image as its note."""
    parts = []
    for child in token.children or []:
        if child.type == "image":
            parts.append(f"[{image_note(child.content)}]")
        elif child.type in ("text", "code_inline"):
            parts.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
    return "".join(parts)


def _docx_picture(paragraph, image: ExportImage, alt: str) -> None:
    from docx.shared import Inches

    inches = _fit(image, _DOCX_TEXT_WIDTH_INCHES, _DOCX_MAX_IMAGE_HEIGHT_INCHES, 1 / _CSS_PX_PER_INCH)
    shape = paragraph.add_run().add_picture(io.BytesIO(image.png), width=Inches(inches))
    properties = shape._inline.docPr
    properties.set("title", image.name)
    properties.set("descr", image_description(alt, image))


def _docx_inline(paragraph, children: list[Token], images: Images) -> None:
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
                _docx_picture(paragraph, image, child.content)
            else:
                paragraph.add_run(image_note(child.content)).italic = True
        elif kind == "softbreak":
            paragraph.add_run(" ")
        elif kind == "hardbreak":
            paragraph.add_run().add_break()


# --- PDF ----------------------------------------------------------------


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
        "pre": DEFAULT_TAG_STYLES["pre"].replace(font_family=code_family),
        "code": DEFAULT_TAG_STYLES["code"].replace(family=code_family),
    }


def _note_tokens(alt: str) -> list[Token]:
    return [
        Token("em_open", "em", 1),
        Token("text", "", 0, content=image_note(alt)),
        Token("em_close", "em", -1),
    ]


def _without_images(tokens: list[Token]) -> list[Token]:
    """Every image as an italic note, so the HTML renderer never writes ``<img>``,
    and a chat file link as its label alone."""
    for token in tokens:
        if token.children:
            children: list[Token] = []
            depth = 0  # Inside a dropped chat file link.
            for child in token.children:
                if child.type == "image":
                    children.extend(_note_tokens(child.content))
                elif child.type == "link_open" and (
                    depth or str(child.attrs.get("href") or "").startswith("asterism-file:")
                ):
                    depth += 1
                elif child.type == "link_close" and depth:
                    depth -= 1
                else:
                    children.append(child)
            token.children = children
    return tokens


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
            if items[-1][1] == "paragraph":
                inline = tokens[index + 1]
                inline.children = [Token("hardbreak", "br", 0), Token("hardbreak", "br", 0), *(inline.children or [])]
            items[-1] = (items[-1][0], "paragraph")
        else:
            items[-1] = (items[-1][0], token.type)
    return tokens


@cache
def _export_html() -> type:
    """fpdf2's HTML renderer, keeping a list item's indent for text that follows
    a nested list or code block in the same item."""
    from fpdf.html import HTML2FPDF

    class _ExportHTML(HTML2FPDF):
        def _write_paragraph(self, text: str, link: int | str | None = None) -> None:
            if text and not self._paragraph and "li" in self._tags_stack:
                margin = getattr(self.tag_styles["li"], "l_margin", 0)
                self._new_paragraph(indent=(margin if isinstance(margin, (int, float)) else 0) * self.indent)
            super()._write_paragraph(text, link)

    return _ExportHTML


def _paragraph(children: list[Token]) -> list[Token]:
    """A paragraph of ``children``, or nothing if they hold no text."""
    while children and (
        children[0].type in ("softbreak", "hardbreak")
        or (children[0].type == "text" and not children[0].content.strip())
    ):
        children = children[1:]
    while children and (
        children[-1].type in ("softbreak", "hardbreak")
        or (children[-1].type == "text" and not children[-1].content.strip())
    ):
        children = children[:-1]
    if not children:
        return []
    inline = Token("inline", "", 0, children=children, level=1)
    return [Token("paragraph_open", "p", 1, block=True), inline, Token("paragraph_close", "p", -1, block=True)]


def markdown_pdf(title: str, content: str, diagrams: Diagrams | None = None, images: Images | None = None) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4")
    pdf.HTML2FPDF_CLASS = _export_html()
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
    pictures = images or {}

    def write(tokens: list[Token]) -> None:
        if tokens:
            pdf.write_html(
                markdown.renderer.render(_without_images(tokens), markdown.options, {}),
                font_family=family,
                li_prefix_color=(0, 0, 0),
                tag_styles=styles,
                warn_on_tags_not_matching=False,
            )

    def picture(image: ExportImage, alt: str) -> None:
        width = _fit(image, _PDF_TEXT_WIDTH_MM, _PDF_MAX_IMAGE_HEIGHT_MM, 25.4 / _CSS_PX_PER_INCH)
        pdf.ln(2)
        pdf.image(io.BytesIO(image.png), w=width, title=image.name, alt_text=image_description(alt, image))
        pdf.ln(4)

    # Drawn diagrams and loaded images go between runs of HTML. Only top-level
    # fences and paragraphs hold pictures; inside a list, quote or table a
    # diagram stays code and an image is written as a note.
    tokens = _list_paragraphs(markdown.parse(text))
    run: list[Token] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        index += 1
        if token.type == "paragraph_open" and token.level == 0 and index < len(tokens):
            inline = tokens[index]
            children = inline.children or []
            found = [pictures.get(_image_id(child)) if child.type == "image" else None for child in children]
            if any(found):
                index += 2  # The inline token and paragraph_close.
                segment: list[Token] = []
                for child, image in zip(children, found, strict=True):
                    if image is None:
                        segment.append(child)
                        continue
                    run.extend(_paragraph(segment))
                    segment = []
                    write(run)
                    run = []
                    picture(image, child.content)
                run.extend(_paragraph(segment))
                continue
        if diagrams is None or token.level != 0 or not is_mermaid(token):
            run.append(token)
            continue
        drawn = diagrams.get(token.content)
        if drawn is None:
            note = markdown.parse(f"*{DIAGRAM_NOT_DRAWN}*")
            run.extend([*note, token])
            continue
        write(run)
        run = []
        width = min(drawn.width * 25.4 / _CSS_PX_PER_INCH, _PDF_TEXT_WIDTH_MM)
        pdf.ln(2)
        pdf.image(io.BytesIO(drawn.png), w=width, title=drawn.label, alt_text=diagram_alt_text(drawn))
        pdf.ln(4)
    write(run)
    return bytes(pdf.output())
