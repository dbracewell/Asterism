from __future__ import annotations

import uuid
from typing import Optional

from pydantic import TypeAdapter
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.common import LLMModel, MessageStatus, ToolCall, ToolResult
from asterism.models.typedefs import JSONB_COLUMN

from . import Base
from .utils import now


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        "id",
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        "session_id",
        Uuid,
        ForeignKey(
            "chats.id",
            ondelete="CASCADE",
            name="message_fk_sesssion_id",
        ),
        nullable=False,
        index=True,
    )
    model: Mapped[LLMModel] = mapped_column(
        "model",
        JSONB_COLUMN(LLMModel),
        nullable=False,
    )
    status: Mapped[MessageStatus] = mapped_column(
        "status",
        SQLEnum(MessageStatus),
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
        nullable=False,
    )
    thinking: Mapped[str] = mapped_column(
        "thinking",
        Text,
        nullable=False,
        server_default="",
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
    created_at: Mapped[int] = mapped_column(
        "created_at",
        Integer,
        nullable=False,
        default=lambda: now(),
    )

    active_child: Mapped[Optional["Message"]] = relationship(
        "Message",
        foreign_keys=[active_child_id],
        remote_side="Message.id",
        post_update=True,
    )

    __table_args__ = (
        Index("idx_messages_active_child_id", "active_child_id"),
        Index("idx_messages_id_user_id", "user_id", "id"),
        Index("idx_messages_session_id", "session_id"),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id}>"
