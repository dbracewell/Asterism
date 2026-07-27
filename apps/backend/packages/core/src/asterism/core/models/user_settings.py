import datetime
from typing import Annotated

from pydantic import BaseModel, Field, JsonValue, WithJsonSchema
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from asterism.core.models.typedefs import JsonColumn

from . import Base


class UserSetting(Base):
    """Per-user settings stored as key-value JSON rows."""

    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    value: Mapped[JsonValue] = mapped_column(JsonColumn)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} user={self.user_id} key={self.key}>"


class UserSettingsModel(BaseModel):
    theme: Annotated[
        str,
        WithJsonSchema(
            {
                "nullable": False,
                "type": "string",
                "default": "light",
            }
        ),
    ] = Field(default="light")
    font_size: Annotated[
        str,
        WithJsonSchema(
            {
                "nullable": False,
                "type": "string",
                "default": "16px",
            }
        ),
    ] = Field(default="16px")
