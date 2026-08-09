import datetime

from pydantic import JsonValue
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from .typedefs import JsonColumn


class AppSetting(Base):
    """Application-wide settings stored as key-value JSON rows."""

    __tablename__ = "app_settings"

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
        return f"<{self.__class__.__name__} key={self.key}>"
