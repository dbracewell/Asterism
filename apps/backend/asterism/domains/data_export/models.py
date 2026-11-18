"""One row per requested archive; the archive itself lives under storage_root/exports."""

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import UuidPrimaryKeyMixin, get_unix_timestamp

EXPORT_STATUSES = ("pending", "running", "ready", "failed")


class DataExportModel(Base, UuidPrimaryKeyMixin):
    """A person's data archive: requested, being built, ready until it expires, or failed.

    Each person keeps at most one: a new request replaces the last. Rows go with
    the account (cascade); the archive file is removed with the account's storage.
    """

    __tablename__ = "data_exports"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    requested_at: Mapped[int] = mapped_column(Integer, nullable=False, default=get_unix_timestamp)
    completed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN (" + ", ".join(f"'{status}'" for status in EXPORT_STATUSES) + ")",
            name="data_export_status_known",
        ),
        Index("ix_data_exports_user_id", "user_id"),
    )
