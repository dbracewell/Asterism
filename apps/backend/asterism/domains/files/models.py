import enum

from sqlalchemy import Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class FileKind(str, enum.Enum):
    IMAGE = "image"
    TEXT = "text"
    DOCUMENT = "document"
    OTHER = "other"


class FileContentStatus(str, enum.Enum):
    PENDING = "pending"
    READY = "ready"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


def _enum_values(enum_type: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_type]


class UserFileModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "user_files"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[FileKind] = mapped_column(
        Enum(FileKind, values_callable=_enum_values, native_enum=False, create_constraint=True),
        nullable=False,
    )
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content_status: Mapped[FileContentStatus] = mapped_column(
        Enum(
            FileContentStatus,
            values_callable=_enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=FileContentStatus.PENDING,
        server_default=FileContentStatus.PENDING.value,
    )
    content_error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content_cache: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "filename", name="uq_user_files_user_filename"),
        Index("idx_user_files_user_filename", "user_id", "filename"),
    )
