import datetime
import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from . import Base
from .utils import now


class Function(Base):
    __tablename__ = "functions"

    id: Mapped[uuid.UUID] = mapped_column(
        "id",
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
    name: Mapped[str] = mapped_column(
        "name",
        String,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        "description",
        Text,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        "content",
        Text,
        nullable=False,
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        "created_at",
        Integer,
        nullable=False,
        default=lambda: now(),
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        "updated_at",
        Integer,
        nullable=False,
        default=lambda: now(),
        onupdate=lambda: now(),
    )


class UserFunctions(Base):
    __tablename__ = "user_functions"

    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    function_id: Mapped[uuid.UUID] = mapped_column(
        "function_id",
        ForeignKey("functions.id", ondelete="CASCADE"),
        primary_key=True,
    )
