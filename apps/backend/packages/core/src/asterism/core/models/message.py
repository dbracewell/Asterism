import datetime
import uuid
from typing import Annotated, Any, Optional

from pydantic import BaseModel, ConfigDict, WithJsonSchema
from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from asterism.core.models.typedefs import JsonColumn

from . import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey(
            "sessions.id",
            ondelete="CASCADE",
            name="message_fk_sesssion_id",
        ),
    )
    parent_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    active_child_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[str] = mapped_column("user_id", String, index=True)
    role: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    thinking: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    tool_calls: Mapped[dict[str, Any]] = mapped_column(
        "tool_calls",
        JsonColumn,
        server_default="[]",
    )
    token_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    created_at: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=lambda: int(
            datetime.datetime.now(tz=datetime.timezone.utc).timestamp()
        ),
    )

    active_child: Mapped[Optional["Message"]] = relationship(
        "Message",
        foreign_keys=[active_child_id],
        remote_side="Message.id",
        post_update=True,  # Crucial: tells SQLAlchemy to insert the row first, THEN update the FK to avoid circular commit errors
    )

    __table_args__ = (
        Index("idx_messages_active_child_id", "active_child_id"),
        Index("idx_messages_active_user_id", "user_id"),
        Index("idx_messages_active_session_id", "session_id"),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id}>"


class NewMessage(BaseModel):
    role: str
    content: str
    token_count: int
    thinking: str = ""
    parent_message_id: uuid.UUID | None = None


class MessageModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    role: str
    content: str
    thinking: str
    created_at: int
    active_child_id: Annotated[
        uuid.UUID | None, WithJsonSchema({"nullable": True, "type": "string"})
    ]
    has_siblings: bool = False
    sibling_count: int = 0
    current_sibling_index: int = -1


class MessageModelList(BaseModel):
    messages: list["MessageModel"]
