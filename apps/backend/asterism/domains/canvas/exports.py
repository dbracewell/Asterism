"""Canvas downloads, produced on the server (ADR-0063, US-72.3).

Every export is built from one stored version. Markdown is parsed without raw
HTML, so a DOCX or PDF never embeds markup or fetches a URL found in canvas
content. An image is embedded only from bytes the caller loaded for an
``asterism-file:`` reference in the chat's scope (ADR-0083); every other image
is written as a short note.

This module picks the format, names and zips the files and re-exports the
format modules' public names: :mod:`.export_markdown` (shared Markdown, image
and diagram helpers), :mod:`.export_docx` and :mod:`.export_pdf`.
"""

import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import TYPE_CHECKING
from urllib.parse import quote

from asterism.core.exceptions import BadDataException

from .schemas import CanvasKind

if TYPE_CHECKING:
    pass
from .export_docx import markdown_docx
from .export_markdown import (
    DIAGRAM_NOT_DRAWN,
    IMAGE_NOT_INCLUDED,
    CanvasExportFormat,
    Diagrams,
    ExportImage,
    Images,
    extension,
    image_note,
    image_references,
    mermaid_sources,
    rewrite_file_references,
)
from .export_pdf import FONT_DIRS, _export_html, _font, markdown_pdf

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


@dataclass(frozen=True)
class ExportedFile:
    filename: str
    media_type: str
    content: bytes


def file_stem(title: str) -> str:
    """A filename stem from a title: no separators, control characters or leading dots."""
    stem = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]+', " ", title)
    stem = " ".join(stem.split()).lstrip(".").strip()[:100].rstrip(". ")
    return stem or "canvas"


def content_disposition(filename: str) -> str:
    """``attachment`` with an ASCII fallback and the UTF-8 name (RFC 6266)."""
    fallback = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", filename) or "canvas"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


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
    """One archive; repeated names get ``(2)``, ``(3)``, … before the extension, in the same folder."""
    buffer = io.BytesIO()
    taken: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            path = PurePosixPath(file.filename)
            name, counter = file.filename, 2
            while name.lower() in taken:
                # The folder stays: "notes/a.md" becomes "notes/a (2).md" (US-117.3).
                name = str(path.with_name(f"{path.stem} ({counter}){path.suffix}"))
                counter += 1
            taken.add(name.lower())
            archive.writestr(name, file.content)
    return buffer.getvalue()


# --- DOCX ---------------------------------------------------------------


# --- PDF ----------------------------------------------------------------

__all__ = [
    "CanvasExportFormat",
    "DIAGRAM_NOT_DRAWN",
    "ExportImage",
    "ExportedFile",
    "FONT_DIRS",
    "FORMATS",
    "IMAGE_NOT_INCLUDED",
    "MEDIA_TYPES",
    "_export_html",
    "_font",
    "content_disposition",
    "export_version",
    "file_stem",
    "image_references",
    "markdown_docx",
    "markdown_pdf",
    "mermaid_sources",
    "zip_exports",
]
