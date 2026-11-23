"""What Asterism remembers about a person, and about their work in a project (ADR-0078).

User memory (``kind = user``) is about the person in every chat and project and
never holds project content; project memory (``kind = project``) belongs to one
of the owner's projects. Only the owner ever reads either.
"""

import uuid
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    Uuid,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

MEMORY_MAX_CHARS = 2_000
MEMORY_MAX_BYTES = 8_000


class MemoryKind(StrEnum):
    USER = "user"
    PROJECT = "project"


class MemoryCategory(StrEnum):
    """What a user memory is about. Project memory has no category."""

    LEARNING = "learning"
    ACCESSIBILITY = "accessibility"
    BACKGROUND = "background"
    OTHER = "other"


class MemorySavedBy(StrEnum):
    """Who saved it: the person themselves, or a proposal of the agent they confirmed."""

    PERSON = "person"
    AGENT = "agent"


def _enum(kind: type[StrEnum]) -> Enum:
    return Enum(kind, values_callable=enum_values, native_enum=False, create_constraint=True)


class MemoryModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "memories"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[MemoryKind] = mapped_column(_enum(MemoryKind), nullable=False)
    # Required for project memory; the composite key below keeps it the owner's project.
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[MemoryCategory | None] = mapped_column(_enum(MemoryCategory), nullable=True)
    sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    saved_by: Mapped[MemorySavedBy] = mapped_column(
        _enum(MemorySavedBy), nullable=False, default=MemorySavedBy.PERSON, server_default=MemorySavedBy.PERSON.value
    )
    # Where it came from. Deleting the chat keeps the memory and empties these.
    source_chat_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chats.id", ondelete="SET NULL"), nullable=True)
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    source_execution_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_executions.id", ondelete="SET NULL"), nullable=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_memories_project_owner",
        ),
        CheckConstraint("revision >= 1", name="ck_memories_revision"),
        CheckConstraint(
            f"length(trim(text)) >= 1 AND length(text) <= {MEMORY_MAX_CHARS}"
            f" AND length(CAST(text AS BLOB)) <= {MEMORY_MAX_BYTES}",
            name="ck_memories_text_bounds",
        ),
        CheckConstraint("instr(text, char(0)) = 0", name="ck_memories_text_no_nul"),
        CheckConstraint(
            "(kind = 'user' AND project_id IS NULL AND category IS NOT NULL)"
            " OR (kind = 'project' AND project_id IS NOT NULL AND category IS NULL)",
            name="ck_memories_kind_scope",
        ),
        CheckConstraint("category IS NULL OR category != 'accessibility' OR sensitive", name="ck_memories_sensitive"),
        Index("idx_memories_owner_kind_project_updated", "user_id", "kind", "project_id", "updated_at", "id"),
    )
