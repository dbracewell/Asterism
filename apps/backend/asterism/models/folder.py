import datetime
import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .chat_session import ChatSession
    from .user import User


class Folder(Base):
    __tablename__ = "folders"

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
            name="folders_fk_user_id",
        ),
        index=True,
    )
    title: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )
    parent_folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey(
            "folders.id",
            ondelete="CASCADE",
            name="fk_folders_parent_id",
        ),
        index=True,
    )

    sessions: Mapped[list["ChatSession"]] = relationship(
        back_populates="folder",
        lazy="selectin",
        cascade="all, delete-orphan",
    )

    user: Mapped["User"] = relationship(
        back_populates="folders",
        lazy="selectin",
    )

    children: Mapped[list["Folder"]] = relationship(
        "Folder",
        back_populates="parent",
        cascade="all, delete-orphan",  # Optional: deletes children if parent is deleted
        lazy="selectin",
    )

    parent: Mapped[Optional["Folder"]] = relationship(
        "Folder",
        remote_side=[id],
        back_populates="children",
        lazy="selectin",
    )
