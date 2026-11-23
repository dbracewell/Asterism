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
    UniqueConstraint,
    Uuid,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin, get_unix_timestamp

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


class MessageMemoryModel(Base, UuidPrimaryKeyMixin):
    """A memory pinned on an accepted user turn: its revision and text then (ADR-0078).

    Execution history is immutable and records only memory ids and revisions;
    the text lives here instead, so deleting the memory (or its message, or the
    account) deletes every pinned copy, and a resume then sends nothing for it.
    Editing the memory leaves pinned copies as they were.
    """

    __tablename__ = "message_memories"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    memory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("memories.id", ondelete="CASCADE"), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Order within the turn's layer: most relevant first.
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("message_id", "memory_id", name="uq_message_memories_message_memory"),
        CheckConstraint("revision >= 1", name="ck_message_memories_revision"),
        CheckConstraint("position >= 0", name="ck_message_memories_position"),
        CheckConstraint(
            f"length(trim(text)) >= 1 AND length(text) <= {MEMORY_MAX_CHARS}"
            f" AND length(CAST(text AS BLOB)) <= {MEMORY_MAX_BYTES}",
            name="ck_message_memories_text_bounds",
        ),
        Index("idx_message_memories_message", "message_id", "position"),
        Index("idx_message_memories_memory", "memory_id"),
    )


class MemoryProposalStatus(StrEnum):
    PENDING = "pending"
    SAVED = "saved"
    DISMISSED = "dismissed"


class MemoryProposalAction(StrEnum):
    PROPOSED = "proposed"
    SAVED = "saved"
    DISMISSED = "dismissed"


class MemoryProposalModel(Base, UuidPrimaryKeyMixin):
    """A memory the agent offered in a chat; nothing is saved until the person confirms (US-93.4).

    A branch-aware chat record: anchored to the run's request message and to the
    run, at most one per run, and deleted with its chat. Saving copies it into
    ``memories``; the proposal keeps the decision.
    """

    __tablename__ = "memory_proposals"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    execution_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_executions.id", ondelete="CASCADE"), nullable=False
    )
    # The proposing agent configuration; kept as a record even if it changes.
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_profiles.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[MemoryKind] = mapped_column(_enum(MemoryKind), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[MemoryCategory | None] = mapped_column(_enum(MemoryCategory), nullable=True)
    sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    status: Mapped[MemoryProposalStatus] = mapped_column(
        _enum(MemoryProposalStatus),
        nullable=False,
        default=MemoryProposalStatus.PENDING,
        server_default=MemoryProposalStatus.PENDING.value,
    )
    memory_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("memories.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, default=get_unix_timestamp)
    decided_at: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_memory_proposals_project_owner",
        ),
        UniqueConstraint("execution_id", name="uq_memory_proposals_execution"),
        CheckConstraint(
            f"length(trim(text)) >= 1 AND length(text) <= {MEMORY_MAX_CHARS}"
            f" AND length(CAST(text AS BLOB)) <= {MEMORY_MAX_BYTES}",
            name="ck_memory_proposals_text_bounds",
        ),
        CheckConstraint("instr(text, char(0)) = 0", name="ck_memory_proposals_text_no_nul"),
        CheckConstraint(
            "(kind = 'user' AND project_id IS NULL AND category IS NOT NULL)"
            " OR (kind = 'project' AND project_id IS NOT NULL AND category IS NULL)",
            name="ck_memory_proposals_kind_scope",
        ),
        CheckConstraint(
            "category IS NULL OR category != 'accessibility' OR sensitive", name="ck_memory_proposals_sensitive"
        ),
        CheckConstraint(
            "(status = 'pending' AND decided_at IS NULL) OR (status != 'pending' AND decided_at IS NOT NULL)",
            name="ck_memory_proposals_decided",
        ),
        Index("idx_memory_proposals_chat", "chat_id", "created_at", "id"),
    )


class MemoryProposalEventModel(Base, UuidPrimaryKeyMixin):
    """The audit record of a proposal and its decision: ids and times only, never text.

    Plain ids, not foreign keys, so the record outlives the chat, the proposal
    and the memory; deleting the account deletes it.
    """

    __tablename__ = "memory_proposal_events"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    proposal_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    chat_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    execution_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    memory_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    action: Mapped[MemoryProposalAction] = mapped_column(_enum(MemoryProposalAction), nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, default=get_unix_timestamp)

    __table_args__ = (Index("idx_memory_proposal_events_user_created", "user_id", "created_at"),)
