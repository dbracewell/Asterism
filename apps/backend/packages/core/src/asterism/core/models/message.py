from __future__ import annotations

import uuid
from enum import StrEnum, auto
from typing import Annotated, Any, Optional, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, WithJsonSchema
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from asterism.core.models.typedefs import JSONB_COLUMN

from ..registries.tool import ToolCall
from . import Base
from .utils import now


class MessageStatus(StrEnum):
    PENDING = auto()
    COMPLETED = auto()


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
    tool_call_id: Mapped[Optional[str]] = mapped_column(
        "tool_call_id",
        String,
        nullable=True,
    )
    tool_calls: Mapped[Optional[list[ToolCall]]] = mapped_column(
        "tool_calls",
        JSONB_COLUMN(TypeAdapter(list[ToolCall])),
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


class LLMMessage(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    role: str
    content: str
    token_count: int
    thinking: Annotated[
        str | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            },
        ),
    ] = Field(default=None)
    tool_calls: Annotated[
        list[ToolCall] | None,
        WithJsonSchema(
            {
                "anyOf": [
                    {"type": "null"},
                    {
                        "type": "array",
                        "items": {"$ref": "#/components/schemas/ToolCall"},
                    },
                ],
            }
        ),
    ] = Field(default=None)
    tool_call_id: Annotated[
        str | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ] = Field(default=None)

    def to_api_message(self) -> dict[str, Any]:
        if self.role == "tool":
            return {
                "role": self.role,
                "content": self.content,
                "tool_call_id": self.tool_call_id,
            }

        if self.role == "assistant":
            data: dict[str, Any] = {"role": "assistant"}
            if self.content:
                data["content"] = self.content
            if self.tool_calls:
                data["tool_calls"] = [
                    tc.model_dump(mode="json") for tc in self.tool_calls
                ]
            return data

        if not self.content:
            raise RuntimeError(f"Invalid message: {self}")

        return {"role": self.role, "content": self.content}

    @classmethod
    def user(cls, content: str) -> Self:
        return cls(role="user", content=content, token_count=0)

    @classmethod
    def system(cls, content: str) -> Self:
        return cls(role="system", content=content, token_count=0)

    @classmethod
    def assistant(
        cls,
        content: str,
        token_count: int,
        thinking: str | None = None,
        tool_calls: list[ToolCall] | None = None,
    ) -> Self:
        return cls(
            role="assistant",
            content=content,
            thinking=thinking,
            tool_calls=tool_calls,
            token_count=token_count,
        )


class MessageModel(LLMMessage):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    status: MessageStatus
    created_at: int
    active_child_id: Annotated[
        uuid.UUID | None,
        WithJsonSchema(
            {
                "anyOf": [{"type": "string"}, {"type": "null"}],
            }
        ),
    ]
    has_siblings: bool = False
    sibling_count: int = 0
    current_sibling_index: int = -1


class MessageModelList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    messages: list[MessageModel]
