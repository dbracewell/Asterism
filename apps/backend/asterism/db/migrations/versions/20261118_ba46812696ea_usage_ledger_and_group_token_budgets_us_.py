"""Usage ledger and group token budgets (US-86.3).

Revision ID: ba46812696ea
Revises: e720dd8451d4
Create Date: 2026-11-18

Adds the empty ``usage_records`` table and the nullable
``groups.daily_token_budget`` and ``groups.monthly_token_budget`` columns
(``ALTER TABLE ADD COLUMN``; nothing is rebuilt, no group gets a budget).
Usage before this revision is not backfilled (ADR-0073). Forward-only: there
is no downgrade.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ba46812696ea"
down_revision: str | None = "e720dd8451d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "usage_records",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.Uuid(), nullable=True),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("images", sa.Integer(), nullable=False),
        sa.Column("input_price_per_million", sa.Float(), nullable=True),
        sa.Column("output_price_per_million", sa.Float(), nullable=True),
        sa.Column("plan", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "source IN ('chat', 'delegation', 'verification', 'disagreement', 'compaction', 'study', 'reflection', 'prompt_coach', 'title', 'caption', 'image')",
            name="ck_usage_records_source",
        ),
        sa.CheckConstraint(
            "(input_price_per_million IS NULL) = (output_price_per_million IS NULL)", name="ck_usage_records_price_pair"
        ),
        sa.CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0 AND images >= 0", name="ck_usage_records_nonnegative"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("usage_records", schema=None) as batch_op:
        batch_op.create_index("ix_usage_records_created", ["created_at"], unique=False)
        batch_op.create_index("ix_usage_records_user_created", ["user_id", "created_at"], unique=False)

    with op.batch_alter_table("groups", schema=None) as batch_op:
        batch_op.add_column(sa.Column("daily_token_budget", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("monthly_token_budget", sa.Integer(), nullable=True))
