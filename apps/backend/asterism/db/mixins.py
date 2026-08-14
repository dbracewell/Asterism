import time
import uuid

from sqlalchemy.orm import Mapped, mapped_column


def get_unix_timestamp() -> int:
    return int(time.time())


class UuidPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    created_at: Mapped[int] = mapped_column(
        default=get_unix_timestamp,
    )
    updated_at: Mapped[int] = mapped_column(
        default=get_unix_timestamp,
        onupdate=get_unix_timestamp,
    )
