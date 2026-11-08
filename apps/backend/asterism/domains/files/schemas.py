"""Pydantic response models for the file API.

These schemas are the transport contract: they are what the generated frontend
client sees and what FastAPI serializes. They deliberately expose the
display-level view of a file (name, size, kind, status) and never the
``storage_key``, so the client cannot address the filesystem directly.
"""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.knowledge.schemas import FileKnowledgeArtifact

from .models import FileContentStatus, FileKind, FileOrigin


class FileProjectSummary(BaseModel):
    """A project that references a file, as shown next to that file.

    Attributes:
        id: Project identifier.
        name: Human-readable project name.
        context_revision: Monotonic counter bumped whenever the project's
            derived context changes. Clients use it to detect staleness.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    context_revision: int = Field(ge=1)


class UserFile(BaseModel):
    """Public representation of one file in the caller's library.

    Attributes:
        id: File identifier.
        filename: Unique display name inside the caller's library.
        original_name: The sanitized name the client uploaded.
        size: Size in bytes of the stored source.
        mime_type: Detected MIME type.
        kind: Classification driving conversion and model input.
        content_status: State of the converted-content cache.
        content_error: Reason for a failed/unsupported conversion, if any.
        created_at: Creation time as whole Unix seconds.
        updated_at: Last update time as whole Unix seconds.
        thumbnail: Data-URL preview for images, else ``None``.
        origin: Whether the user uploaded the file or an agent tool produced it.
        projects: Projects that currently attach this file.
        knowledge: Latest knowledge artifact for this file, if one exists.
        managed_by_class: Class whose course manages this file, if any.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    original_name: str
    size: int = Field(ge=0)
    mime_type: str
    kind: FileKind
    content_status: FileContentStatus
    content_error: str | None
    created_at: int
    updated_at: int
    thumbnail: str | None
    origin: FileOrigin
    projects: list[FileProjectSummary] = Field(default_factory=list)
    knowledge: FileKnowledgeArtifact | None = None
    # Class whose course manages this record, so the student cannot change it (US-67.2).
    managed_by_class: str | None = None


class UserFileList(BaseModel):
    """A page of files plus the pagination envelope.

    Attributes:
        files: Files on this page.
        total: Total number of matching files across all pages.
        page: 1-based page number that was returned.
        page_size: Number of files requested per page.
    """

    files: list[UserFile]
    total: int = Field(default=0, ge=0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1)


class SimilarFile(BaseModel):
    """One file ranked against a query file by embedding similarity.

    Attributes:
        file: The matching file.
        score: Cosine similarity between the query file's centroid direction
            and the candidate's best-matching chunk, clamped to ``[-1, 1]``.
    """

    file: UserFile
    score: float = Field(ge=-1, le=1, description="Cosine similarity between file embeddings")


class SimilarFileList(BaseModel):
    """Ranked list of files similar to a query file.

    Attributes:
        files: Candidates ordered by descending similarity score.
    """

    files: list[SimilarFile]


class FilePreview(BaseModel):
    """Plain-text preview of one source, for document cards (US-56.5).

    The excerpt is the leading part of the cached MarkItDown conversion. Clients
    render it as literal text, never as Markdown or HTML. Counts are read from
    the source's structure and are ``None`` when unknown.

    Attributes:
        file_id: File identifier.
        kind: Classification driving conversion and display.
        mime_type: Detected MIME type.
        status: State of the converted-content cache.
        excerpt: Leading converted text, or ``None`` when there is none.
        truncated: Whether the converted text continues past the excerpt.
        page_count: Pages of a PDF, or of a Word document when it records them.
        slide_count: Slides of a PowerPoint presentation.
        sheet_count: Worksheets of an Excel workbook.
    """

    file_id: uuid.UUID
    kind: FileKind
    mime_type: str
    status: FileContentStatus
    excerpt: str | None
    truncated: bool
    page_count: int | None = None
    slide_count: int | None = None
    sheet_count: int | None = None
