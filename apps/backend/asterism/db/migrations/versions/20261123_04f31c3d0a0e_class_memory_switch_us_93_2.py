"""class memory switch (US-93.2)

Revision ID: 04f31c3d0a0e
Revises: 8cf8b3b71e49
Create Date: 2026-11-23

Forward-only (ADR-0069): there is no downgrade. Adds classes.memory_enabled, the
educator's switch for long-term memory in a course (ADR-0078). Existing classes
get 1 (memory follows the admin policy and each student's own setting), so
nothing changes until an educator turns it off.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "04f31c3d0a0e"
down_revision: str | None = "8cf8b3b71e49"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("classes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("memory_enabled", sa.Boolean(), server_default="1", nullable=False))
