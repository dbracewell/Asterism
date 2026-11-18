"""data exports (US-86.8)

Revision ID: 2a4c7bb2e747
Revises: ba46812696ea
Create Date: 2026-11-18 17:08:37.425730

Forward-only (ADR-0069): there is no downgrade. Adds the data_exports table for
Download my data (ADR-0076). No existing table or stored data changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2a4c7bb2e747"
down_revision: str | None = "ba46812696ea"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "data_exports",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("requested_at", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'running', 'ready', 'failed')", name="data_export_status_known"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("data_exports", schema=None) as batch_op:
        batch_op.create_index("ix_data_exports_user_id", ["user_id"], unique=False)
