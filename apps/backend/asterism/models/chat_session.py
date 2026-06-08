import datetime
import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .message import Message
    from .user import User


class ChatSession(Base):
    __tablename__ = "sessions"
    # __table_args__ = (UniqueConstraint("user_id", "id", name="uq_user_chat_session"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE", name="sessions_fk_user_id"),
        index=True,
    )
    title: Mapped[Optional[str]] = mapped_column(String)
    system_prompt: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )

    user: Mapped["User"] = relationship(
        back_populates="chats",
        cascade="all",
    )
