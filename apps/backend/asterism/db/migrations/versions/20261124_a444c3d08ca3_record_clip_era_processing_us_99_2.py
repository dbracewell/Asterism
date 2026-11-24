"""Record which model embedded the stored files before the switch to e5 (US-99.2).

Revision ID: a444c3d08ca3
Revises: 5d2e7a9c4b1f
Create Date: 2026-11-24

ADR-0079 replaces the CLIP embedding model with multilingual-e5-small. On start,
an installation whose stored processing policy names another model queues every
file again under the new one. But most installations never stored a policy: the
built-in default was used, and the built-in default now names e5, so nothing
would say the files were embedded by CLIP.

This data migration writes that built-in CLIP-era default as the stored
``knowledge.processing`` setting when there is none and files have knowledge
artifacts. The next start then sees ``onnx-clip-v1``, starts a new generation
and re-embeds every file. With no artifacts, or with a stored policy, nothing
changes. No schema change; forward-only.
"""

import hashlib
import json
import time
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a444c3d08ca3"
down_revision: str | None = "5d2e7a9c4b1f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SETTING_KEY = "knowledge.processing"
# The built-in policy before ADR-0079, as knowledge/policy.py defined it.
CLIP_ERA = {
    "extraction_policy": "text-extraction-v1",
    "chunking_policy": "bounded-chunking-v1",
    "embedding_model": "onnx-clip-v1",
    "captioning_policy": "captioning-configuration-v1",
    "captioning": {"mode": "disabled", "provider_model_id": None},
}


def _identity(policy: dict) -> str:
    """The same fingerprint as knowledge.policy.processing_identity."""
    content = json.dumps(policy, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(content).hexdigest()


def upgrade() -> None:
    connection = op.get_bind()
    stored = connection.execute(sa.text("SELECT 1 FROM app_settings WHERE key = :key"), {"key": SETTING_KEY}).first()
    if stored is not None:
        return
    if connection.execute(sa.text("SELECT 1 FROM file_knowledge_artifacts LIMIT 1")).first() is None:
        return
    value = {"schema_version": 1, "generation": 1, "identity": _identity(CLIP_ERA), **CLIP_ERA}
    now = int(time.time())
    connection.execute(
        sa.text("INSERT INTO app_settings (key, value, created_at, updated_at) VALUES (:key, :value, :now, :now)"),
        {"key": SETTING_KEY, "value": json.dumps(value), "now": now},
    )
