"""Persisted metadata for user-uploaded source files.

The row is the authoritative record of *what was uploaded*; the bytes live in
the file store and are addressed by the opaque ``storage_key``. Derived state
(converted text, thumbnail, knowledge artifacts) is kept on the row or in the
knowledge domain, never inside the store.
"""

import enum

from sqlalchemy import Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class FileKind(str, enum.Enum):
    """Coarse classification that decides how a source is converted and read.

    The kind is derived at upload time from the detected MIME type and the
    filename suffix, and it drives :mod:`asterism.domains.files.processor`:
    images are passed to a vision model as binary data, text is read directly,
    documents are converted, and everything else is treated as unsupported.
    """

    IMAGE = "image"
    """Image bytes; surfaced to a model as an image part, never as cached text."""

    TEXT = "text"
    """Plain-text source; read directly as UTF-8 (with a BOM-tolerant fallback)."""

    DOCUMENT = "document"
    """Structured document (PDF, DOCX, XLSX, …) converted to text."""

    OTHER = "other"
    """Unknown or unsupported type; marked unsupported instead of converted."""


class FileContentStatus(str, enum.Enum):
    """Lifecycle of the converted-content cache held by a :class:`UserFileModel`.

    ``PENDING`` is the initial state of every upload. The processor moves a
    file to ``READY`` once usable content is cached, to ``UNSUPPORTED`` when the
    kind cannot be converted at all, and to ``FAILED`` for transient or
    deterministic failures (missing bytes, too large, conversion error).
    """

    PENDING = "pending"
    """Conversion has not produced a usable cache yet."""

    READY = "ready"
    """``content_cache`` holds usable content (possibly empty for images)."""

    UNSUPPORTED = "unsupported"
    """The file kind can never be converted; retrying will not help."""

    FAILED = "failed"
    """Conversion failed; ``content_error`` explains why and may be retryable."""


class UserFileModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """One uploaded source file owned by exactly one user.

    The model separates three names on purpose:

    - ``filename``       – the unique *display* name inside the user's library
                           (``report.txt``, ``report(2).txt``). It is what the
                           API addresses a file by.
    - ``original_name``  – the sanitized name the client sent, kept so the
                           download can preserve it even after de-duplication.
    - ``storage_key``    – an opaque handle resolved only by the file store.

    ``content_status``/``content_error``/``content_cache`` describe the
    derived-text cache; ``thumbnail`` holds a small data URL for images.
    """

    __tablename__ = "user_files"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    """Owner of the file. Every query in this domain filters on this column."""

    filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    """Unique display name within the user's library (see the unique constraint)."""

    storage_key: Mapped[str] = mapped_column(String(1024), nullable=False, unique=True)
    """Opaque handle for the stored bytes; only the file store resolves it."""

    original_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    """Sanitized client-supplied name, preserved for download and de-duplication."""

    size: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    """Size in bytes of the stored source at the time it was last inspected."""

    mime_type: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    """Detected MIME type (content-sniffed first, filename-derived as fallback)."""

    kind: Mapped[FileKind] = mapped_column(
        Enum(
            FileKind,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
    )
    """Classification that selects the conversion strategy."""

    sha256: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    """Hex digest of the stored bytes; also used as the download ETag."""

    content_status: Mapped[FileContentStatus] = mapped_column(
        Enum(
            FileContentStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=FileContentStatus.PENDING,
        server_default=FileContentStatus.PENDING.value,
    )
    """State of the converted-content cache (see :class:`FileContentStatus`)."""

    content_error: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
    """Human-readable reason for a ``FAILED``/``UNSUPPORTED`` status, else ``None``."""

    content_cache: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    """Truncated plain-text conversion of the source, ready for model input."""

    thumbnail: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    """``data:image/jpeg;base64,...`` preview for image files, else ``None``."""

    __table_args__ = (
        # Composite foreign keys from chat_files, chat_draft_files and
        # project_files reference (id, user_id). SQLite only accepts a
        # foreign key whose parent columns are the primary key or carry a
        # unique constraint, so this one is required even though ``id`` alone
        # is already unique.
        UniqueConstraint("id", "user_id", name="uq_user_files_id_user"),
        # A user's library cannot contain two files with the same display name.
        # The implicit unique index this constraint creates also serves the
        # owner-scoped lookups, so no separate index on the same columns is
        # needed.
        UniqueConstraint("user_id", "filename", name="uq_user_files_user_filename"),
    )
