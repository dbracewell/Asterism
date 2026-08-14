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


class AgentProfileModel(Base, UuidPrimaryKeyMixin):
    __tablename__ = "agent_profiles"
    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    model_id: Mapped[uuid.UUID] = mapped_column(
        "model_id",
        ForeignKey("models.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    name: Mapped[str] = mapped_column(
        "name",
        Text,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        "description",
        Text,
        nullable=False,
    )
    system_prompt: Mapped[Optional[str]] = mapped_column(
        "system_prompt",
        Text,
        nullable=True,
    )
    max_steps: Mapped[int] = mapped_column(
        "max_steps",
        Integer,
        nullable=False,
        default=5,
    )
    chat_parameters: Mapped[ChatCompletionParams] = mapped_column(
        "chat_parameters",
        JSONB_COLUMN(),
        nullable=False,
        default=lambda: ChatCompletionParams().__dict__,
    )
    tools: Mapped[Optional[list[str]]] = mapped_column(
        "tools",
        JSONB_COLUMN(),
        nullable=True,
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
