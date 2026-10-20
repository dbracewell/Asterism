"""Reusable ORM column mixins shared by domain models."""

import time
import uuid

from sqlalchemy.orm import Mapped, mapped_column


def get_unix_timestamp() -> int:
    """Current wall-clock time as whole Unix seconds (used as a column default)."""
    return int(time.time())


class UuidPrimaryKeyMixin:
    """Adds a client-generated ``uuid4`` primary key column named ``id``."""

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    """Adds integer Unix-second ``created_at``/``updated_at`` audit columns.

    Resolution is one second: two updates within the same second leave
    ``updated_at`` unchanged.
    """

    created_at: Mapped[int] = mapped_column(
        default=get_unix_timestamp,
    )
    updated_at: Mapped[int] = mapped_column(
        default=get_unix_timestamp,
        onupdate=get_unix_timestamp,
    )
