import datetime

from pydantic import BaseModel, Field, JsonValue
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from asterism.core.models import Base
from asterism.core.models.typedefs import JsonColumn


class AppSetting(Base):
    """Application-wide settings stored as key-value JSON rows."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    value: Mapped[JsonValue] = mapped_column(JsonColumn)
    updated_by: Mapped[str] = mapped_column(String)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} key={self.key}>"


class LLMModel(BaseModel):
    name: str
    is_active: bool


class LLMProvider(BaseModel):
    name: str
    base_url: str
    api_key: str
    models: list[LLMModel]


class ApplicationSettingsModel(BaseModel):
    llm_providers: list[LLMProvider] = Field(default_factory=list)
