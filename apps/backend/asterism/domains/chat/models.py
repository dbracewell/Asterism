import uuid
from typing import Optional

from pydantic import TypeAdapter
from sqlalchemy import UUID, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from asterism.domains.llm.schemas import ToolCall, ToolResult

from .schemas import MessageStatus


class ChatModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "chats"

    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "folder_id",
        ForeignKey("folders.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    title: Mapped[Optional[str]] = mapped_column(
        "title",
        String,
        nullable=True,
    )

    __table_args__ = (Index("idx_chat_id_user", "id", "user_id"),)


class MessageModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "messages"

    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        "chat_id",
        UUID,
        ForeignKey(
            "chats.id",
            ondelete="CASCADE",
            name="message_fk_sesssion_id",
        ),
        nullable=False,
        index=True,
    )
    model_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "model_id",
        UUID,
        nullable=True,
    )
    status: Mapped[MessageStatus] = mapped_column(
        "status",
        Enum(MessageStatus),
        nullable=False,
        default=MessageStatus.PENDING,
    )
    parent_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "parent_message_id",
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    active_child_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "active_child_id",
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(
        "role",
        String,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        "content",
        Text,
        nullable=False,
    )
    thinking: Mapped[str] = mapped_column(
        "thinking",
        Text,
        nullable=False,
        default="",
    )
    tool_calls: Mapped[Optional[list[ToolCall]]] = mapped_column(
        "tool_calls",
        JSONB_COLUMN(TypeAdapter(list[ToolCall])),
        nullable=True,
    )
    tool_call_results: Mapped[Optional[list[ToolResult]]] = mapped_column(
        "tool_call_results",
        JSONB_COLUMN(TypeAdapter(list[ToolResult])),
        nullable=True,
    )
    token_count: Mapped[int] = mapped_column(
        "token_count",
        Integer,
        nullable=False,
    )

    active_child: Mapped[Optional["MessageModel"]] = relationship(
        "MessageModel",
        foreign_keys=[active_child_id],
        remote_side="MessageModel.id",
        post_update=True,
    )
