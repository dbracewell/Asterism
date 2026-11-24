"""chat drafts of decks and quizzes (US-98.2)

Revision ID: 2114351c62ff
Revises: 5c9a5a096d23
Create Date: 2026-11-24

Forward-only (ADR-0069): there is no downgrade. Adds study_proposals, the decks
and quizzes the assistant drafts in a project chat (EPIC-98, ADR-0080); nothing
reaches Study until the person saves one. Decks and quizzes get the draft and
chat they were saved from, as plain ids, and a quiz's origin may now be "chat".
Existing rows keep null provenance and their origin.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2114351c62ff"
down_revision: str | None = "5c9a5a096d23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "study_proposals",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("execution_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("saved_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("decided_at", sa.Integer(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("kind IN ('deck', 'quiz')", name="ck_study_proposals_kind"),
        sa.CheckConstraint("status IN ('pending', 'saved', 'dismissed')", name="ck_study_proposals_status"),
        sa.CheckConstraint(
            "(status = 'pending' AND decided_at IS NULL AND saved_id IS NULL)"
            " OR (status = 'dismissed' AND decided_at IS NOT NULL AND saved_id IS NULL)"
            " OR (status = 'saved' AND decided_at IS NOT NULL AND saved_id IS NOT NULL)",
            name="ck_study_proposals_decided",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["execution_id"], ["chat_executions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_study_proposals_project_owner",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("execution_id", "kind", name="uq_study_proposals_execution_kind"),
    )
    op.create_index("idx_study_proposals_chat", "study_proposals", ["chat_id", "created_at", "id"], unique=False)
    op.create_index("idx_study_proposals_user", "study_proposals", ["user_id", "created_at"], unique=False)
    with op.batch_alter_table("study_decks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("proposal_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("source_chat_id", sa.Uuid(), nullable=True))
    with op.batch_alter_table("study_quizzes", schema=None, recreate="always") as batch_op:
        batch_op.add_column(sa.Column("proposal_id", sa.Uuid(), nullable=True))
        batch_op.add_column(sa.Column("source_chat_id", sa.Uuid(), nullable=True))
        batch_op.drop_constraint("ck_study_quizzes_origin", type_="check")
        batch_op.create_check_constraint(
            "ck_study_quizzes_origin",
            "(origin IN ('generated', 'chat') AND model_name IS NOT NULL) OR origin = 'practice'",
        )
