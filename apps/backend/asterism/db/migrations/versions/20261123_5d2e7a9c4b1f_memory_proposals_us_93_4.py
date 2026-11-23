"""memory proposals (US-93.4)

Revision ID: 5d2e7a9c4b1f
Revises: 49c16efb8995
Create Date: 2026-11-23

Forward-only (ADR-0069): there is no downgrade. Adds memory_proposals, the
memories the agent offers in a chat until the person saves or dismisses them,
and memory_proposal_events, their audit record (ids and times only). Both start
empty. No existing table or stored data changes.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5d2e7a9c4b1f"
down_revision: str | None = "49c16efb8995"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(*values: str, name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True)


def upgrade() -> None:
    op.create_table(
        "memory_proposal_events",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("proposal_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("memory_id", sa.Uuid(), nullable=True),
        sa.Column("action", _enum("proposed", "saved", "dismissed", name="memoryproposalaction"), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_memory_proposal_events_user_created", "memory_proposal_events", ["user_id", "created_at"], unique=False
    )
    op.create_table(
        "memory_proposals",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("kind", _enum("user", "project", name="memorykind"), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "category", _enum("learning", "accessibility", "background", "other", name="memorycategory"), nullable=True
        ),
        sa.Column("sensitive", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "status",
            _enum("pending", "saved", "dismissed", name="memoryproposalstatus"),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("memory_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("decided_at", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "(kind = 'user' AND project_id IS NULL AND category IS NOT NULL)"
            " OR (kind = 'project' AND project_id IS NOT NULL AND category IS NULL)",
            name="ck_memory_proposals_kind_scope",
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND decided_at IS NULL) OR (status != 'pending' AND decided_at IS NOT NULL)",
            name="ck_memory_proposals_decided",
        ),
        sa.CheckConstraint(
            "category IS NULL OR category != 'accessibility' OR sensitive", name="ck_memory_proposals_sensitive"
        ),
        sa.CheckConstraint("instr(text, char(0)) = 0", name="ck_memory_proposals_text_no_nul"),
        sa.CheckConstraint(
            "length(trim(text)) >= 1 AND length(text) <= 2000 AND length(CAST(text AS BLOB)) <= 8000",
            name="ck_memory_proposals_text_bounds",
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agent_profiles.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["execution_id"], ["chat_executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_memory_proposals_project_owner",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("execution_id", name="uq_memory_proposals_execution"),
    )
    op.create_index("idx_memory_proposals_chat", "memory_proposals", ["chat_id", "created_at", "id"], unique=False)
