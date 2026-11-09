"""Canvas downloads, produced on the server (ADR-0063, US-72.3).

Every export is built from one stored version. Markdown is parsed without raw
HTML or images, so a DOCX or PDF never embeds markup or fetches a URL found in
canvas content.
"""

import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from markdown_it import MarkdownIt
from markdown_it.token import Token

from asterism.core.exceptions import BadDataException

from .schemas import CanvasKind

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


def _markdown() -> MarkdownIt:
    # No raw HTML, no images: exports never carry markup or fetch URLs.
    return MarkdownIt("commonmark", {"html": False}).enable("table").disable("image")


def export_version(
    *, kind: CanvasKind, language: str, title: str, content: str, export: CanvasExportFormat
) -> ExportedFile:
    if export not in FORMATS[kind]:
        allowed = ", ".join(FORMATS[kind])
        raise BadDataException(f"A {kind} item downloads as {allowed}")
    filename = f"{file_stem(title)}.{extension(kind, language, export)}"
    if export == "docx":
        data = markdown_docx(title, content)
    elif export == "pdf":
        data = markdown_pdf(title, content)
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


def markdown_docx(title: str, content: str) -> bytes:
    from docx import Document
    from docx.shared import Pt

    document = Document()
    document.core_properties.title = title
    tokens = _markdown().parse(content)
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
        elif kind in ("fence", "code_block"):
            code(token.content)
        elif kind == "hr":
            document.add_paragraph("—" * 3)
        elif kind == "table_open":
            table = []
        elif kind == "tr_open" and table is not None:
            table.append([])
        elif kind == "inline" and table is not None:
            table[-1].append(token.content)
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
            _docx_inline(target, token.children or [])
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _docx_inline(paragraph, children: list[Token]) -> None:
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
            link = str(child.attrs.get("href") or "")
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


def markdown_pdf(title: str, content: str) -> bytes:
    from fpdf import FPDF

    pdf = FPDF(format="A4")
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
    html = _markdown().render(text)
    pdf.write_html(
        html,
        font_family=family,
        li_prefix_color=(0, 0, 0),
        tag_styles=_pdf_styles(code_family),
        warn_on_tags_not_matching=False,
    )
    return bytes(pdf.output())
