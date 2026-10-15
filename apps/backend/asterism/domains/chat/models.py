import uuid

from pydantic import TypeAdapter
from sqlalchemy import (
    UUID,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.common.enums import enum_values
from asterism.core.config import default_allowed_tools
from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from asterism.domains.llm.schemas import ToolCall, ToolResult

from .schemas import ChatModelChoice, MessageExecution, MessageFileReference, MessageStatus


class ChatModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "chats"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_profiles.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    # Retain unavailable/deleted selections instead of retargeting the chat.
    selected_model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    selected_model_snapshot: Mapped[ChatModelChoice | None] = mapped_column(
        JSONB_COLUMN(TypeAdapter(ChatModelChoice)),
        nullable=True,
    )
    model_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )
    allowed_tools: Mapped[list[str]] = mapped_column(
        JSONB_COLUMN(TypeAdapter(list[str])),
        nullable=False,
        default=default_allowed_tools,
    )

    __table_args__ = (
        CheckConstraint("model_revision >= 1", name="chat_model_revision_positive"),
        UniqueConstraint("id", "user_id", name="uq_chats_id_user"),
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_chats_project_owner",
        ),
    )


class MessageModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "messages"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID,
        ForeignKey(
            "chats.id",
            ondelete="CASCADE",
            name="message_fk_session_id",
        ),
        nullable=False,
        index=True,
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        nullable=True,
    )
    execution: Mapped[MessageExecution | None] = mapped_column(
        JSONB_COLUMN(TypeAdapter(MessageExecution)),
        nullable=True,
    )
    pending_execution: Mapped[MessageExecution | None] = mapped_column(
        JSONB_COLUMN(TypeAdapter(MessageExecution)),
        nullable=True,
    )
    status: Mapped[MessageStatus] = mapped_column(
        Enum(
            MessageStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=MessageStatus.PENDING,
    )
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    active_child_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    thinking: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
    )
    tool_calls: Mapped[list[ToolCall] | None] = mapped_column(
        JSONB_COLUMN(TypeAdapter(list[ToolCall])),
        nullable=True,
    )
    tool_call_results: Mapped[list[ToolResult | None]] = mapped_column(
        JSONB_COLUMN(TypeAdapter(list[ToolResult])),
        nullable=True,
    )
    files: Mapped[list[MessageFileReference]] = mapped_column(
        JSONB_COLUMN(TypeAdapter(list[MessageFileReference])),
        nullable=False,
        default=list,
    )
    input_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    total_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    generation_duration_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    __table_args__ = (
        UniqueConstraint("id", "chat_id", "user_id", name="uq_messages_id_chat_user"),
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chats.id", "chats.user_id"],
            ondelete="CASCADE",
            name="fk_messages_chat_owner",
        ),
        ForeignKeyConstraint(
            ["parent_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_messages_parent_scope",
        ),
        ForeignKeyConstraint(
            ["active_child_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_messages_active_child_scope",
        ),
    )

    active_child: Mapped["MessageModel | None"] = relationship(
        "MessageModel",
        foreign_keys=[active_child_id],
        remote_side="MessageModel.id",
        post_update=True,
    )


class ChatFileModel(Base, TimestampMixin):
    """Explicit local source references; active-branch provenance narrows this set."""

    __tablename__ = "chat_files"
    chat_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chats.id", "chats.user_id"],
            ondelete="CASCADE",
            name="fk_chat_files_chat_owner",
        ),
        ForeignKeyConstraint(
            ["file_id", "user_id"],
            ["user_files.id", "user_files.user_id"],
            ondelete="CASCADE",
            name="fk_chat_files_file_owner",
        ),
        Index("idx_chat_files_file_owner", "file_id", "user_id"),
    )
