import uuid
from typing import Optional

from pydantic import JsonValue
from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from asterism.domains.llm.schemas import ChatCompletionParams


class ProviderModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "providers"

    name: Mapped[str] = mapped_column(
        "name",
        Text,
        nullable=False,
        unique=True,
    )
    base_url: Mapped[str] = mapped_column(
        "base_url",
        Text,
        nullable=False,
    )
    api_key: Mapped[str] = mapped_column(
        "api_key",
        Text,
        nullable=False,
    )
    models: Mapped[list["LLMModel"]] = relationship(
        "LLMModel",
        back_populates="provider",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class LLMModel(Base, UuidPrimaryKeyMixin):
    __tablename__ = "models"
    name: Mapped[str] = mapped_column(
        "name",
        Text,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        "is_active",
        Boolean,
        nullable=False,
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        "provider_id",
        ForeignKey(
            column="providers.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    provider: Mapped[ProviderModel] = relationship(
        "ProviderModel",
        back_populates="models",
    )


class UserSettingModel(Base, TimestampMixin):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    value: Mapped[JsonValue] = mapped_column(JSONB_COLUMN())


class ApplicationSettingsModel(Base, TimestampMixin):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    value: Mapped[JsonValue] = mapped_column(JSONB_COLUMN())
