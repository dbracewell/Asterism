import datetime
import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .chat_session import ChatSession


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    session_id: Mapped[str] = mapped_column(
        ForeignKey(
            "sessions.id",
            ondelete="CASCADE",
            name="message_fk_sesssion_id",
        ),
        index=True,
    )
    parent_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("messages.id")
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            name="message_fk_users_id",
        ),
        index=True,
    )
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(
        nullable=False,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(server_default=func.now())

    session: Mapped["ChatSession"] = relationship(
        back_populates="messages",
        lazy="selectin",
    )

    parent: Mapped[Optional["Message"]] = relationship(
        "Message",
        remote_side=[id],
        backref="children",
        lazy="selectin",
    )
