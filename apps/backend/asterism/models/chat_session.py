import datetime
import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .folder import Folder
    from .message import Message
    from .user import User


class ChatSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="CASCADE",
            name="sessions_fk_user_id",
        ),
        index=True,
    )
    folder_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(
            "folders.id",
            ondelete="CASCADE",
            name="sessions_fk_folder_id",
        ),
        index=True,
    )
    title: Mapped[str] = mapped_column(String)
    system_prompt: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    folder: Mapped[Optional["Folder"]] = relationship(
        back_populates="sessions",
        lazy="selectin",
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    user: Mapped["User"] = relationship(
        back_populates="sessions",
        lazy="selectin",
    )
