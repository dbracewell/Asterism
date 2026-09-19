import uuid

from pydantic import JsonValue
from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

from .provider_types import ModelCapabilitySource, ProviderType


def _enum_values(enum_type):
    return [member.value for member in enum_type]


class ProviderModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "providers"

    provider_type: Mapped[ProviderType] = mapped_column(
        Enum(
            ProviderType,
            values_callable=_enum_values,
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            name="provider_type",
        ),
        nullable=False,
        default=ProviderType.GENERIC_OPENAI,
        server_default=ProviderType.GENERIC_OPENAI.value,
    )
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
    __table_args__ = (
        CheckConstraint(
            "context_window IS NULL OR context_window > 0",
            name="ck_models_context_window_positive",
        ),
    )

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
    context_window: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    supports_vision: Mapped[bool | None] = mapped_column(
        Boolean(create_constraint=True, name="ck_models_supports_vision_boolean"),
        nullable=True,
    )
    context_window_source: Mapped[ModelCapabilitySource] = mapped_column(
        Enum(
            ModelCapabilitySource,
            values_callable=_enum_values,
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            name="context_window_source",
        ),
        nullable=False,
        default=ModelCapabilitySource.UNKNOWN,
        server_default=ModelCapabilitySource.UNKNOWN.value,
    )
    vision_source: Mapped[ModelCapabilitySource] = mapped_column(
        Enum(
            ModelCapabilitySource,
            values_callable=_enum_values,
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            name="vision_source",
        ),
        nullable=False,
        default=ModelCapabilitySource.UNKNOWN,
        server_default=ModelCapabilitySource.UNKNOWN.value,
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
