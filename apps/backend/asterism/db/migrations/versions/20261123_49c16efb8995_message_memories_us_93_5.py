"""message memories (US-93.5)

Revision ID: 49c16efb8995
Revises: 04f31c3d0a0e
Create Date: 2026-11-23

Forward-only (ADR-0069): there is no downgrade. Adds message_memories, the
memories pinned on each accepted turn (ADR-0078). Recorded executions keep only
memory ids and revisions; the pinned text lives here and is deleted with the
memory, the message or the account. Turns accepted before this upgrade have
none, so their runs use no memories. No existing table or stored data changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "49c16efb8995"
down_revision: str | None = "04f31c3d0a0e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_memories",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "length(trim(text)) >= 1 AND length(text) <= 2000 AND length(CAST(text AS BLOB)) <= 8000",
            name="ck_message_memories_text_bounds",
        ),
        sa.CheckConstraint("position >= 0", name="ck_message_memories_position"),
        sa.CheckConstraint("revision >= 1", name="ck_message_memories_revision"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "memory_id", name="uq_message_memories_message_memory"),
    )
    op.create_index("idx_message_memories_memory", "message_memories", ["memory_id"], unique=False)
    op.create_index("idx_message_memories_message", "message_memories", ["message_id", "position"], unique=False)
