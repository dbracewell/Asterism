"""Unsent attachment references and durable send acknowledgements."""

import uuid

from pydantic import TypeAdapter
from sqlalchemy import ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class ChatDraftModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "chat_drafts"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    selected_file_ids: Mapped[list[uuid.UUID]] = mapped_column(
        JSONB_COLUMN(TypeAdapter(list[uuid.UUID])),
        nullable=False,
        default=list,
    )
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_chat_drafts_owner"),
        ForeignKeyConstraint(["chat_id", "user_id"], ["chats.id", "chats.user_id"], ondelete="CASCADE"),
    )


class ChatDraftFileModel(Base):
    __tablename__ = "chat_draft_files"
    draft_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(["draft_id", "user_id"], ["chat_drafts.id", "chat_drafts.user_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["file_id", "user_id"], ["user_files.id", "user_files.user_id"], ondelete="CASCADE"),
    )


class ChatSendReceiptModel(Base):
    __tablename__ = "chat_send_receipts"
    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    message_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(["chat_id", "user_id"], ["chats.id", "chats.user_id"], ondelete="CASCADE"),
        ForeignKeyConstraint(
            ["message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            ondelete="CASCADE",
        ),
    )
