"""Content-free audit records for knowledge lifecycle operations."""

import uuid

from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class KnowledgeAuditEventModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "knowledge_audit_events"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    knowledge_base_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[dict[str, str | int]] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (Index("idx_knowledge_audit_events_user_created", "user_id", "created_at"),)


def record_knowledge_audit(
    *,
    user_id: str,
    action: str,
    knowledge_base_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    details: dict[str, str | int] | None = None,
) -> KnowledgeAuditEventModel:
    """Create a metadata-only audit row; callers must never pass document text."""
    return KnowledgeAuditEventModel(
        user_id=user_id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        action=action,
        details=details or {},
    )
