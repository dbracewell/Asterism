"""Compaction records: a summary of the branch prefix ending at one message (ADR-0060)."""

import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import UuidPrimaryKeyMixin, get_unix_timestamp


class CompactionTrigger(StrEnum):
    AUTOMATIC = "automatic"
    MANUAL = "manual"


class ChatCompactionModel(Base, UuidPrimaryKeyMixin):
    """The anchor is the branch key: the record applies to every branch that contains it."""

    __tablename__ = "chat_compactions"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    # The last message the summary covers; the root-to-anchor path is what it replaces.
    through_message_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    previous_compaction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_compactions.id", ondelete="SET NULL"), nullable=True
    )
    # Untrusted model output; never parsed for capabilities.
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    replaced_messages: Mapped[int] = mapped_column(Integer, nullable=False)
    model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    model_name: Mapped[str] = mapped_column(String, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_tokens_before: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trigger: Mapped[CompactionTrigger] = mapped_column(
        Enum(CompactionTrigger, values_callable=enum_values, native_enum=False, create_constraint=True),
        nullable=False,
        default=CompactionTrigger.AUTOMATIC,
    )
    created_at: Mapped[int] = mapped_column(default=get_unix_timestamp)

    __table_args__ = (
        UniqueConstraint("chat_id", "through_message_id", name="uq_compaction_chat_anchor"),
        CheckConstraint("replaced_messages >= 1", name="ck_compaction_replaced_positive"),
        CheckConstraint("input_tokens >= 0 AND output_tokens >= 0", name="ck_compaction_usage_nonnegative"),
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chats.id", "chats.user_id"],
            ondelete="CASCADE",
            name="fk_compaction_chat_owner",
        ),
        ForeignKeyConstraint(
            ["through_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            ondelete="CASCADE",
            name="fk_compaction_anchor_owner",
        ),
    )
