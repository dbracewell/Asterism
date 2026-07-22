import datetime
import uuid
from typing import TYPE_CHECKING, Annotated, Optional

from pydantic import BaseModel, ConfigDict, WithJsonSchema
from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from . import Base

if TYPE_CHECKING:
    from .message import MessageModel


class ChatSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String,
        index=True,
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
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
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} id={self.id}>"


class NewChatSessionRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    folder_id: Annotated[
        uuid.UUID | None,
        WithJsonSchema(  # noqa: F821
            {
                "nullable": True,
                "type": "string",
            }
        ),
    ]


class ChatSessionUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    title: Annotated[str | None, WithJsonSchema({"nullable": True})] = None
    folder_id: Annotated[uuid.UUID | None, WithJsonSchema({"nullable": True})] = None


class ChatSessionInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    title: str
    folder_id: uuid.UUID | None
    system_prompt: str | None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class ChatSessionModel(BaseModel):
    info: ChatSessionInfo
    messages: list["MessageModel"]


class ChatSessionInfoList(BaseModel):
    sessions: list["ChatSessionInfo"]
