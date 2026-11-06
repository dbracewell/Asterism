"""Learner reflections (US-58.2): explicit, user-owned records, never automatic memory.

Each reflection is partitioned by user, persona (profile) and project; General
reflections have no project. The source chat is kept as a link only.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class ReflectionModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "reflections"

    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Deleting a persona deletes the reflections recorded under it.
    persona_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    # A deleted project's reflections move to General, like its chats.
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chats.id", ondelete="SET NULL"), nullable=True)
    learned: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    unclear: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        ForeignKeyConstraint(
            ["persona_id", "user_id"],
            ["user_personas.id", "user_personas.user_id"],
            ondelete="CASCADE",
            name="fk_reflections_persona_owner",
        ),
        CheckConstraint("revision >= 1", name="ck_reflections_revision"),
        CheckConstraint("length(learned) <= 2000 AND length(unclear) <= 2000", name="ck_reflections_length"),
        CheckConstraint("length(trim(learned)) > 0 OR length(trim(unclear)) > 0", name="ck_reflections_nonempty"),
        Index("idx_reflections_owner_scope", "user_id", "project_id", "persona_id", "created_at"),
    )
