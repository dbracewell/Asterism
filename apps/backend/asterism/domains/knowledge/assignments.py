import uuid

from sqlalchemy import ForeignKey, Index, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class AgentKnowledgeBaseAssignmentModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """Explicit, ordered user-owned knowledge allowlist for one agent."""

    __tablename__ = "agent_knowledge_base_assignments"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("agent_id", "knowledge_base_id", name="uq_agent_knowledge_base_assignment"),
        UniqueConstraint("agent_id", "position", name="uq_agent_knowledge_base_assignment_position"),
        Index("idx_agent_knowledge_base_assignments_agent_position", "agent_id", "position"),
    )
