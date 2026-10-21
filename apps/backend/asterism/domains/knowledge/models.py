import uuid
from enum import StrEnum

from pydantic import JsonValue
from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.expression import true

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.columns import jsonb_type
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class KnowledgeExtractionKind(StrEnum):
    """The derived outputs a source file can produce.

    The set is closed: every kind gets its own status, provider, model, safe
    errors, and payload, so adding an output does not reshape the artifact.
    """

    TEXT_EXTRACTION = "text_extraction"
    EMBEDDING = "embedding"
    CAPTIONING = "captioning"


class KnowledgeExtractionStatus(StrEnum):
    """One lifecycle vocabulary shared by a generation and by every kind.

    A generation is ``running`` while it is being produced, and so is a single
    derived output while its own work is in flight.
    """

    PENDING = "pending"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"
    CANCELED = "canceled"


class KnowledgeCaptionMode(StrEnum):
    DISABLED = "disabled"
    PROVIDER = "provider"
    LOCAL = "local"


class FileKnowledgeArtifactModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """One versioned generation of a file's derived knowledge.

    The row owns the generation's identity, its lifecycle, and the
    denormalized aggregate the retrieval path reads. The derived outputs
    themselves live in :class:`FileKnowledgeExtractionModel`, one row per kind.
    """

    __tablename__ = "file_knowledge_artifacts"

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
    status: Mapped[KnowledgeExtractionStatus] = mapped_column(
        Enum(
            KnowledgeExtractionStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=KnowledgeExtractionStatus.PENDING,
    )
    is_current: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    searchable: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    """Denormalized retrieval aggregate: the generation has searchable text.

    Text chunks make it searchable, and so does a caption. It stays on the
    artifact row so the retrieval hot path remains a single-row read.
    """
    chunk_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
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
            # At most one current generation per file, enforced by the
            # database. The predicate is declared for every dialect that
            # supports partial unique indexes, so the invariant does not
            # silently disappear on the next storage adapter.
            "uq_file_knowledge_artifacts_one_current",
            "file_id",
            unique=True,
            sqlite_where=(is_current == true()),
            postgresql_where=(is_current == true()),
        ),
    )


class FileKnowledgeExtractionModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """One derived output of a knowledge artifact.

    Each artifact owns at most one row per kind. The row carries that output's
    own status, the provider and model that produced it, its safe errors, and
    its kind-specific payload.
    """

    __tablename__ = "file_knowledge_extractions"

    artifact_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("file_knowledge_artifacts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[KnowledgeExtractionKind] = mapped_column(
        Enum(
            KnowledgeExtractionKind,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
    )
    status: Mapped[KnowledgeExtractionStatus] = mapped_column(
        Enum(
            KnowledgeExtractionStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=KnowledgeExtractionStatus.PENDING,
    )
    provider: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )
    model: Mapped[str | None] = mapped_column(
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
    payload: Mapped[JsonValue | None] = mapped_column(
        jsonb_type(),
        nullable=True,
    )
    """The kind-specific result. Validated per kind at the application boundary."""
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
            "artifact_id",
            "kind",
            name="uq_file_knowledge_extractions_artifact_kind",
        ),
        Index(
            "idx_file_knowledge_extractions_artifact_status",
            "artifact_id",
            "status",
        ),
    )
