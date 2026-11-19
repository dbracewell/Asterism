"""Name the model on compaction records saved with its id (US-90.3).

Revision ID: c3a1f0d2b9e4
Revises: 2a4c7bb2e747
Create Date: 2026-11-19

Before US-90.3, "Compact now" outside a run stored the chat model's id as
``chat_compactions.model_name``, so the divider read "Written by a09bb3f6-…".
A data migration only: each record whose name is exactly its own ``model_id``
gets that model's visible name (its display name, else its name). Records whose
model has since been deleted keep their stored value. No schema change.
Forward-only: there is no downgrade.
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3a1f0d2b9e4"
down_revision: str | None = "2a4c7bb2e747"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _as_uuid(value: object) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def upgrade() -> None:
    connection = op.get_bind()
    records = connection.execute(
        sa.text("SELECT id, model_id, model_name FROM chat_compactions WHERE model_id IS NOT NULL")
    ).fetchall()
    for record_id, model_id, model_name in records:
        stored = _as_uuid(model_id)
        if stored is None or _as_uuid(model_name) != stored:
            continue
        name = connection.execute(
            sa.text("SELECT coalesce(display_name, name) FROM models WHERE id = :id"),
            {"id": model_id},
        ).scalar()
        if name:
            connection.execute(
                sa.text("UPDATE chat_compactions SET model_name = :name WHERE id = :id"),
                {"name": name, "id": record_id},
            )
