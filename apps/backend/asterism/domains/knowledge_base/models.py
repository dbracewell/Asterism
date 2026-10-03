import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class AgentKnowledgeBaseAssignmentModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """Explicit, ordered user-owned knowledge allowlist for one agent."""

    __tablename__ = "agent_knowledge_base_assignments"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "agent_id",
            "knowledge_base_id",
            name="uq_agent_knowledge_base_assignment",
        ),
        UniqueConstraint(
            "agent_id",
            "position",
            name="uq_agent_knowledge_base_assignment_position",
        ),
        Index(
            "idx_agent_knowledge_base_assignments_agent_position",
            "agent_id",
            "position",
        ),
    )


class KnowledgeBaseModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "knowledge_bases"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "name",
            name="uq_knowledge_bases_user_name",
        ),
        Index(
            "idx_knowledge_bases_user_updated",
            "user_id",
            "updated_at",
        ),
    )


class KnowledgeBaseFileModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """An ordered collection membership, deliberately free of derived data."""

    __tablename__ = "knowledge_base_files"

    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user_files.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint(
            "knowledge_base_id",
            "file_id",
            name="uq_knowledge_base_files_base_file",
        ),
        UniqueConstraint(
            "knowledge_base_id",
            "position",
            name="uq_knowledge_base_files_base_position",
        ),
        Index(
            "idx_knowledge_base_files_base_position",
            "knowledge_base_id",
            "position",
        ),
    )
