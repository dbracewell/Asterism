"""Record which service each OpenAI-compatible provider is (US-125.1)

Revision ID: 9be2d4a01c7f
Revises: 5c38bc190c46
Create Date: 2026-11-28

Forward-only (ADR-0069): there is no downgrade. ADR-0086 adds a nullable
``providers.service``: the OpenAI-compatible service a provider was set up from,
such as ``openrouter`` or ``ollama``. Existing providers get NULL, which reads as
Custom. A check keeps it to ``generic_openai`` providers. The column is text, not
an enum, so adding a service to the catalog later needs no migration.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9be2d4a01c7f"
down_revision: str | None = "5c38bc190c46"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("providers", schema=None, recreate="always") as batch_op:
        batch_op.add_column(sa.Column("service", sa.String(length=32), nullable=True))
        batch_op.create_check_constraint(
            "ck_providers_service_generic",
            "service IS NULL OR provider_type = 'generic_openai'",
        )
