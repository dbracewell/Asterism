import datetime
import uuid
from typing import TYPE_CHECKING, Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, WithJsonSchema
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .chat_session import ChatSessionInfo


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        "user_id",
        String,
        index=True,
    )
    title: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey(
            "folders.id",
            ondelete="CASCADE",
            name="fk_folders_parent_id",
        ),
        index=True,
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id}>"


class NewFolderRequest(BaseModel):
    title: str
    parent_id: Annotated[
        uuid.UUID | None,
        WithJsonSchema(
            {
                "nullable": True,
                "type": "string",
            }
        ),
    ]


class GetFolderRequest(BaseModel):
    id: uuid.UUID
    include_children: bool


class FlatFolderModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    title: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    parent_id: Optional[uuid.UUID]
    sessions: list["ChatSessionInfo"] = Field(default_factory=list)


class FolderModel(FlatFolderModel):
    children: list["FolderModel"] = Field(default_factory=list)


class FolderModelList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    folders: list["FolderModel"]
