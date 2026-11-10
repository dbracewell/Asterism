"""The audit record of every image generation attempt (ADR-0064)."""

import uuid

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import UuidPrimaryKeyMixin, get_unix_timestamp

from .schemas import ImageGenerationStatus


class ImageGenerationModel(Base, UuidPrimaryKeyMixin):
    """One request: who asked, what for, which model, and how it ended.

    Kept when its chat or files are deleted, so the audit trail stays whole;
    deleting the user deletes it.
    """

    __tablename__ = "image_generations"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chats.id", ondelete="SET NULL"), nullable=True, index=True
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    negative_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    revision: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[ImageGenerationStatus] = mapped_column(String(16), nullable=False)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Saved files with their seeds: [{"file_id", "seed"}]; ids may outlive the files.
    images: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[int] = mapped_column(default=get_unix_timestamp, index=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('completed', 'failed', 'refused', 'cancelled')", name="ck_image_generations_status"
        ),
    )
