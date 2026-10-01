import uuid
from enum import StrEnum

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.expression import true


class FileKnowledgeArtifactStatus(StrEnum):
    """Lifecycle of one immutable derived-artifact generation."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
    CANCELED = "canceled"


class KnowledgeCaptionStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DRAFT = "draft"
    ACCEPTED = "accepted"
    CLEARED = "cleared"
    FAILED = "failed"
    CANCELED = "canceled"


class KnowledgeCaptionMode(StrEnum):
    DISABLED = "disabled"
    PROVIDER = "provider"
    LOCAL = "local"


class FileExtractionModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "file_extractions"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_files.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    generation: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    processing_profile_generation: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    processing_profile_identity: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    contract_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )
    status: Mapped[FileKnowledgeArtifactStatus] = mapped_column(
        Enum(
            FileKnowledgeArtifactStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=FileKnowledgeArtifactStatus.PENDING,
    )
    is_current: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    extracted_content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    chunk_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    text_embeddings_ready: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    visual_embedding_ready: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    caption_status: Mapped[KnowledgeCaptionStatus | None] = mapped_column(
        Enum(
            KnowledgeCaptionStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=True,
    )
    caption_source: Mapped[KnowledgeCaptionMode | None] = mapped_column(
        Enum(
            KnowledgeCaptionMode,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=True,
    )
    caption_model: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
    caption_text: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    caption_error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    caption_error_reason: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
    error_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    error_reason: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
    started_at: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    completed_at: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "file_id",
            "generation",
            name="uq_file_knowledge_artifacts_file_generation",
        ),
        Index(
            "idx_file_knowledge_artifacts_user_file_status",
            "user_id",
            "file_id",
            "status",
            "updated_at",
        ),
        Index(
            "uq_file_knowledge_artifacts_one_current",
            "file_id",
            unique=True,
            sqlite_where=(is_current == true()),
        ),
    )

    @property
    def caption(self) -> dict[str, str | int | None]:
        """Expose canonical caption fields as the API's stable nested shape."""
        return {
            "status": self.caption_status.value if self.caption_status is not None else None,
            "source": self.caption_source.value if self.caption_source is not None else None,
            "model": self.caption_model,
            "text": self.caption_text,
            "error_code": self.caption_error_code,
            "error_reason": self.caption_error_reason,
            "generated_at": self.completed_at,
            "accepted_at": None,
        }
