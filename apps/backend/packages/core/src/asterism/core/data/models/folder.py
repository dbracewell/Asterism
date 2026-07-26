from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING, Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .chat import ChatInfo


class Folder(Base):
    __tablename__ = "folders"

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
    title: Mapped[str] = mapped_column(
        "title",
        String,
        nullable=False,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        "created_at",
        DateTime,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        "updated_at",
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "parent_id",
        ForeignKey(
            "folders.id",
            ondelete="CASCADE",
            name="fk_folders_parent_id",
        ),
        nullable=True,
        index=True,
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id}>"

    __table_args__ = (Index("idx_folder_id_user", "id", "user_id"),)


class FlatFolderModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    title: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    parent_id: Optional[uuid.UUID]
    sessions: list["ChatInfo"] = Field(default_factory=list)


class FolderModel(FlatFolderModel):
    children: list[FolderModel] = Field(default_factory=list)


class FolderModelList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    folders: list[FolderModel]
