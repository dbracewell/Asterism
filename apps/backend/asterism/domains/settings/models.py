"""ORM models for LLM providers, provider models, and key/value settings tables.

Two table families live here:

- ``providers`` / ``models``: admin-managed LLM provider configuration and the
  models each provider exposes, including capability flags and the provenance
  (``*_source``) of each capability value.
- ``user_settings`` / ``app_settings``: untyped JSON key/value stores; the
  allowed keys and their shapes are validated in :mod:`service`, not by the
  database schema.
"""

import uuid

from pydantic import JsonValue
from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.db.base_model import Base
from asterism.db.columns import jsonb_type
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

from .provider_types import ModelCapabilitySource, ProviderType
from .secrets import EncryptedText


def _enum_values(enum_type):
    """Return the stored string values of a StrEnum (used to name CHECK constraints)."""
    return [member.value for member in enum_type]


class ProviderModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """An LLM provider endpoint configured by an admin (table ``providers``).

    ``api_key`` is encrypted at rest via :class:`EncryptedText`; reads return
    the decrypted value, so callers must treat it as a secret and redact it in
    API responses (see :class:`ProviderInfo`).
    """

    __tablename__ = "providers"
    __table_args__ = (
        # Admin providers are global; a CHATGPT provider belongs to exactly one
        # user and each user has at most one.
        CheckConstraint(
            "(provider_type = 'chatgpt') = (owner_user_id IS NOT NULL)",
            name="ck_providers_chatgpt_owned",
        ),
        UniqueConstraint("owner_user_id", name="uq_providers_owner"),
        Index(
            "uq_providers_global_name",
            "name",
            unique=True,
            sqlite_where=text("owner_user_id IS NULL"),
        ),
    )

    # Provider flavor; OPENAI pins the base URL server-side (see provider_types).
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
    # Display name; unique across global (admin) providers.
    name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    # Set only for a user's own CHATGPT provider; global providers are NULL.
    owner_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    base_url: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    # Encrypted at rest; decrypted transparently on read.
    api_key: Mapped[str] = mapped_column(
        EncryptedText,
        nullable=False,
    )
    models: Mapped[list["LLMModel"]] = relationship(
        "LLMModel",
        back_populates="provider",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class LLMModel(Base, UuidPrimaryKeyMixin):
    """A model exposed by a provider (table ``models``).

    Capability columns (``context_window``, ``supports_vision``,
    ``supports_tools``) are paired with provenance enums (``*_source``) that
    record where each value came from: catalog, provider metadata, manual admin
    edit, or unknown. Discovery merges preserve MANUAL values over fresh
    provider data (see :func:`discovery.merge_discovered_models`).
    """

    __tablename__ = "models"
    __table_args__ = (
        CheckConstraint(
            "context_window IS NULL OR context_window > 0",
            name="ck_models_context_window_positive",
        ),
        Index("ix_models_provider_name_id", "provider_id", "name", "id"),
    )

    # The provider's model identifier (e.g. "gpt-4o"); unique per provider via the index above.
    name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    # Human-readable label when the provider supplies one (ChatGPT plan models).
    display_name: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
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
    supports_tools: Mapped[bool | None] = mapped_column(
        Boolean(create_constraint=True, name="ck_models_supports_tools_boolean"), nullable=True
    )
    tools_source: Mapped[ModelCapabilitySource] = mapped_column(
        Enum(
            ModelCapabilitySource,
            values_callable=_enum_values,
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            name="tools_source",
        ),
        nullable=False,
        default=ModelCapabilitySource.UNKNOWN,
        server_default=ModelCapabilitySource.UNKNOWN.value,
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
    # No single-column index: lookups by provider_id are covered by the leading
    # column of ix_models_provider_name_id.
    provider_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(ProviderModel.id, ondelete="CASCADE"),
        nullable=False,
    )

    provider: Mapped[ProviderModel] = relationship(
        "ProviderModel",
        back_populates="models",
    )


class UserSettingModel(Base, TimestampMixin):
    """One row per (user, setting key) in ``user_settings``.

    ``value`` is untyped JSON; the whitelist of keys and their shapes is
    enforced in :func:`service._validate_user_setting`, not by the schema.
    Composite primary key ``(user_id, key)``.
    """

    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    # Explicit NOT NULL: JsonValue is a union containing None, so the annotation
    # alone would leave the column nullable. Clearing a setting deletes its row.
    value: Mapped[JsonValue] = mapped_column(jsonb_type(), nullable=False)


class ApplicationSettingsModel(Base, TimestampMixin):
    """Global application settings as JSON rows keyed by name (``app_settings``).

    Keys include ``llm_providers``, ``draft_model_id``, component provider
    selections (with encrypted parameter values), ``active_tools``, and the
    knowledge processing policy. Key validation lives in :mod:`service`.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    # Explicit NOT NULL: JsonValue is a union containing None, so the annotation
    # alone would leave the column nullable. Clearing a setting deletes its row.
    value: Mapped[JsonValue] = mapped_column(jsonb_type(), nullable=False)
