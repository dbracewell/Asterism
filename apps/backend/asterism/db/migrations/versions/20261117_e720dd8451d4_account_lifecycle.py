"""Account lifecycle: suspension and deletion requests (US-86.2).

Revision ID: e720dd8451d4
Revises: 7526419cbbde
Create Date: 2026-11-17

Adds the nullable ``users.suspended_at`` column (``ALTER TABLE ADD COLUMN``;
nothing is rebuilt, existing users stay active) and the empty
``account_deletion_requests`` table. Forward-only: there is no downgrade.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e720dd8451d4"
down_revision: str | None = "7526419cbbde"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_deletion_requests",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("requested_at", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("suspended_at", sa.Integer(), nullable=True))
