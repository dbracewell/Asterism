"""class switch for decks and quizzes from chat (US-98.1)

Revision ID: 5c9a5a096d23
Revises: a444c3d08ca3
Create Date: 2026-11-24

Forward-only (ADR-0069): there is no downgrade. Adds classes.study_chat_enabled,
the educator's switch for the assistant drafting decks and quizzes in a course
project (EPIC-98). Existing classes get 1, so nothing changes until an educator
turns it off.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5c9a5a096d23"
down_revision: str | None = "a444c3d08ca3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("classes", schema=None) as batch_op:
        batch_op.add_column(sa.Column("study_chat_enabled", sa.Boolean(), server_default="1", nullable=False))
