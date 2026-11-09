"""Canvas items and their immutable versions, owned through their chat (ADR-0063)."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin, get_unix_timestamp

from .schemas import CanvasAuthor, CanvasKind


class CanvasItemModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "canvas_items"

    chat_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[CanvasKind] = mapped_column(String(16), nullable=False)
    # Required for code (for highlighting and the download extension), else empty.
    language: Mapped[str] = mapped_column(String(32), nullable=False, default="", server_default="")

    __table_args__ = (
        ForeignKeyConstraint(
            ["chat_id", "user_id"], ["chats.id", "chats.user_id"], ondelete="CASCADE", name="fk_canvas_items_chat"
        ),
        CheckConstraint("kind IN ('document', 'code', 'html')", name="ck_canvas_items_kind"),
        CheckConstraint("(kind = 'code') = (language != '')", name="ck_canvas_items_language"),
        Index("idx_canvas_items_chat", "chat_id", "user_id"),
    )


class CanvasVersionModel(Base):
    __tablename__ = "canvas_versions"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("canvas_items.id", ondelete="CASCADE"), primary_key=True, nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[CanvasAuthor] = mapped_column(String(8), nullable=False)
    # The branch anchor: the run's request message, or the leaf when a user saved.
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The agent run that wrote it; None for user edits.
    execution_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chat_executions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[int] = mapped_column(default=get_unix_timestamp)

    __table_args__ = (
        CheckConstraint("number >= 1", name="ck_canvas_versions_number"),
        CheckConstraint("author IN ('agent', 'user')", name="ck_canvas_versions_author"),
        CheckConstraint("(author = 'agent') = (execution_id IS NOT NULL)", name="ck_canvas_versions_execution"),
        CheckConstraint("length(trim(title)) BETWEEN 1 AND 200", name="ck_canvas_versions_title"),
    )
