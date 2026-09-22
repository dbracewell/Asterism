import enum
import uuid

from sqlalchemy import JSON, CheckConstraint, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class KnowledgeDocumentStatus(str, enum.Enum):
    PENDING = "pending"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"


class KnowledgeCaptionStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    DRAFT = "draft"
    ACCEPTED = "accepted"
    CLEARED = "cleared"
    FAILED = "failed"
    CANCELED = "canceled"


class KnowledgeCaptionMode(str, enum.Enum):
    DISABLED = "disabled"
    PROVIDER = "provider"
    LOCAL = "local"


def _enum_values(enum_type: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_type]


class KnowledgeCaptionConfigurationModel(Base, TimestampMixin):
    """The single administrator-controlled captioning configuration."""

    __tablename__ = "knowledge_caption_configuration"
    __table_args__ = (CheckConstraint("id = 1", name="ck_knowledge_caption_configuration_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    mode: Mapped[KnowledgeCaptionMode] = mapped_column(
        Enum(KnowledgeCaptionMode, values_callable=_enum_values, native_enum=False, create_constraint=True),
        nullable=False,
        default=KnowledgeCaptionMode.DISABLED,
    )
    provider_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("models.id", ondelete="SET NULL"), nullable=True
    )


class KnowledgeBaseModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "knowledge_bases"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_knowledge_bases_user_name"),
        Index("idx_knowledge_bases_user_updated", "user_id", "updated_at"),
    )


class KnowledgeDocumentModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "knowledge_documents"

    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user_files.id", ondelete="SET NULL"), nullable=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[KnowledgeDocumentStatus] = mapped_column(
        Enum(KnowledgeDocumentStatus, values_callable=_enum_values, native_enum=False, create_constraint=True),
        nullable=False,
        default=KnowledgeDocumentStatus.PENDING,
    )
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    indexed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    replaces_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"), nullable=True
    )
    # Captions are revision-scoped derived metadata. They never replace the
    # immutable source file or the independent image embedding.
    caption_status: Mapped[KnowledgeCaptionStatus | None] = mapped_column(
        Enum(KnowledgeCaptionStatus, values_callable=_enum_values, native_enum=False, create_constraint=True),
        nullable=True,
    )
    caption_source: Mapped[KnowledgeCaptionMode | None] = mapped_column(
        Enum(KnowledgeCaptionMode, values_callable=_enum_values, native_enum=False, create_constraint=True),
        nullable=True,
    )
    caption_model: Mapped[str | None] = mapped_column(String(512), nullable=True)
    caption_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    caption_error_reason: Mapped[str | None] = mapped_column(String(512), nullable=True)
    caption_generated_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    caption_accepted_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_: Mapped[dict[str, str]] = mapped_column("metadata", JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("knowledge_base_id", "file_id", name="uq_knowledge_documents_base_file"),
        Index("idx_knowledge_documents_base_status", "knowledge_base_id", "status", "updated_at"),
    )
