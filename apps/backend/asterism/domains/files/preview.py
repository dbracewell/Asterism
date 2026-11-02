"""Document previews for inline file cards (US-56.5, ADR-0039 §8).

A preview is a text excerpt from the cached MarkItDown conversion plus page,
slide or sheet counts read from the source structure. No page or slide images
are rendered; thumbnails are deferred (ADR-0039 §8).

Callers authorize first: this module only enforces ownership.
"""

import asyncio
import re
import uuid
import zipfile
from pathlib import Path

import pypdfium2
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException

from .models import FileKind, UserFileModel
from .processor import ensure_file_processed
from .queries import select_owned_files
from .schemas import FilePreview
from .store import get_file_store

MAX_PREVIEW_CHARS = 4_000
"""Longest excerpt returned; cards show less."""

_MAX_ZIP_MEMBERS = 10_000
_MAX_APP_XML_BYTES = 64 * 1024

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF = "application/pdf"


def document_counts(path: Path, mime_type: str) -> dict[str, int | None]:
    """Count pages, slides or sheets from the source's structure, never its text.

    Malformed, encrypted or oversized-archive sources yield no counts.
    """
    try:
        if mime_type == PDF:
            document = pypdfium2.PdfDocument(path)
            try:
                return {"page_count": len(document)}
            finally:
                document.close()
        if mime_type in (DOCX, PPTX, XLSX):
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
                if len(names) > _MAX_ZIP_MEMBERS:
                    return {}
                if mime_type == PPTX:
                    return {"slide_count": sum(bool(re.fullmatch(r"ppt/slides/slide\d+\.xml", n)) for n in names)}
                if mime_type == XLSX:
                    return {"sheet_count": sum(bool(re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)) for n in names)}
                if "docProps/app.xml" not in names:
                    return {}
                with archive.open("docProps/app.xml") as source:
                    pages = re.search(rb"<(?:\w+:)?Pages>(\d{1,6})</", source.read(_MAX_APP_XML_BYTES))
                return {"page_count": int(pages.group(1))} if pages else {}
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, pypdfium2.PdfiumError):
        return {}
    return {}


async def build_file_preview(*, user_id: str, file_id: uuid.UUID, session: AsyncSession) -> FilePreview:
    """Build the preview of one of the caller's files.

    Raises:
        NotFoundException: If the file is not the caller's.
    """
    file = await session.scalar(select_owned_files(user_id=user_id).where(UserFileModel.id == file_id))
    if file is None:
        raise NotFoundException("File not found")
    file = await ensure_file_processed(file=file, session=session)
    text = file.content_cache if file.kind is not FileKind.IMAGE else None
    counts: dict[str, int | None] = {}
    path = get_file_store().open(user_id, file.storage_key)
    if path.is_file():
        counts = await asyncio.to_thread(document_counts, path, file.mime_type)
    return FilePreview(
        file_id=file.id,
        kind=file.kind,
        mime_type=file.mime_type,
        status=file.content_status,
        excerpt=text[:MAX_PREVIEW_CHARS] if text else None,
        truncated=bool(text) and len(text) > MAX_PREVIEW_CHARS,
        **counts,
    )
