"""The usage ledger (ADR-0073): one append-only row per completed model call or image request."""

import uuid

from sqlalchemy import CheckConstraint, Float, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import UuidPrimaryKeyMixin, get_unix_timestamp

USAGE_SOURCES = (
    "chat",
    "delegation",
    "verification",
    "disagreement",
    "compaction",
    "study",
    "reflection",
    "prompt_coach",
    "title",
    "caption",
    "image",
)


class UsageRecordModel(Base, UuidPrimaryKeyMixin):
    """Who used which model for what, how many tokens, and the price then.

    The model name and prices are copied, so a later price change or a deleted
    model never rewrites past usage. Chats may be deleted; the row stays.
    """

    __tablename__ = "usage_records"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    chat_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    images: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # US dollars per million tokens at call time; NULL when the model had no price.
    input_price_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_price_per_million: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Run on the user's ChatGPT plan: tokens count, dollars do not.
    plan: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="0")
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, default=get_unix_timestamp)

    __table_args__ = (
        Index("ix_usage_records_user_created", "user_id", "created_at"),
        Index("ix_usage_records_created", "created_at"),
        CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0 AND images >= 0", name="ck_usage_records_nonnegative"
        ),
        CheckConstraint(
            "source IN (" + ", ".join(f"'{source}'" for source in USAGE_SOURCES) + ")",
            name="ck_usage_records_source",
        ),
        CheckConstraint(
            "(input_price_per_million IS NULL) = (output_price_per_million IS NULL)",
            name="ck_usage_records_price_pair",
        ),
    )
