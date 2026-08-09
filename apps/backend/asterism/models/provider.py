import uuid

from sqlalchemy import Boolean, ForeignKey, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = mapped_column(
        "id",
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    name: Mapped[str] = mapped_column("name", Text, nullable=False, unique=True)
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
    models: Mapped[list["LLMModelDB"]] = relationship(
        "LLMModelDB",
        back_populates="provider",
        lazy="selectin",
        cascade="all, delete-orphan",
    )


class LLMModelDB(Base):
    __tablename__ = "models"
    id: Mapped[uuid.UUID] = mapped_column(
        "id",
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        "name",
        Text,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        "is_active", Boolean, nullable=False
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
    provider: Mapped["Provider"] = relationship(
        "Provider",
        back_populates="models",
    )
