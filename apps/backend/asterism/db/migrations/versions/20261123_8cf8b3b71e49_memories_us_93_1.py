"""memories (US-93.1)

Revision ID: 8cf8b3b71e49
Revises: c3a1f0d2b9e4
Create Date: 2026-11-23

Forward-only (ADR-0069): there is no downgrade. Adds the memories table for
long-term memory (ADR-0078). No existing table or stored data changes; memory
vectors live in their own LanceDB table, created on first use.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8cf8b3b71e49"
down_revision: str | None = "c3a1f0d2b9e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "memories",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("user", "project", name="memorykind", native_enum=False, create_constraint=True),
            nullable=False,
        ),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "category",
            sa.Enum(
                "learning",
                "accessibility",
                "background",
                "other",
                name="memorycategory",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column("sensitive", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "saved_by",
            sa.Enum("person", "agent", name="memorysavedby", native_enum=False, create_constraint=True),
            server_default="person",
            nullable=False,
        ),
        sa.Column("source_chat_id", sa.Uuid(), nullable=True),
        sa.Column("source_message_id", sa.Uuid(), nullable=True),
        sa.Column("source_execution_id", sa.Uuid(), nullable=True),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "(kind = 'user' AND project_id IS NULL AND category IS NOT NULL)"
            " OR (kind = 'project' AND project_id IS NOT NULL AND category IS NULL)",
            name="ck_memories_kind_scope",
        ),
        sa.CheckConstraint(
            "category IS NULL OR category != 'accessibility' OR sensitive", name="ck_memories_sensitive"
        ),
        sa.CheckConstraint("instr(text, char(0)) = 0", name="ck_memories_text_no_nul"),
        sa.CheckConstraint(
            "length(trim(text)) >= 1 AND length(text) <= 2000 AND length(CAST(text AS BLOB)) <= 8000",
            name="ck_memories_text_bounds",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_memories_revision"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_memories_project_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["source_chat_id"], ["chats.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_execution_id"], ["chat_executions.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["source_message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_memories_owner_kind_project_updated",
        "memories",
        ["user_id", "kind", "project_id", "updated_at", "id"],
        unique=False,
    )
