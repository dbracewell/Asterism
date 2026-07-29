import datetime
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from . import Base
from .utils import now


class Chat(Base):
    __tablename__ = "chats"

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
    created_at: Mapped[datetime.datetime] = mapped_column(
        "created_at",
        Integer,
        nullable=False,
        default=lambda: now(),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        "updated_at",
        Integer,
        nullable=False,
        default=lambda: now(),
        onupdate=lambda: now(),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id}>"

    __table_args__ = (Index("idx_chat_id_user", "id", "user_id"),)
