"""Private skill documents and owner/role-consistent main-agent assignments."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class SkillModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "skills"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_skills_owner_name"),
        UniqueConstraint("id", "user_id", name="uq_skills_id_owner"),
        CheckConstraint("revision >= 1", name="ck_skills_revision"),
        CheckConstraint("length(name) BETWEEN 1 AND 64", name="ck_skills_name_length"),
        CheckConstraint("length(trim(description)) BETWEEN 1 AND 1024", name="ck_skills_description_length"),
        CheckConstraint("length(content) BETWEEN 1 AND 65536", name="ck_skills_content_length"),
        Index("idx_skills_owner_updated", "user_id", "updated_at", "id"),
    )


class AgentSkillModel(Base, TimestampMixin):
    __tablename__ = "agent_skills"

    agent_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    skill_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    sub_agent: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="0")

    __table_args__ = (
        CheckConstraint("sub_agent = false", name="ck_agent_skills_main_only"),
        ForeignKeyConstraint(
            ["agent_id", "user_id", "sub_agent"],
            ["agent_profiles.id", "agent_profiles.user_id", "agent_profiles.sub_agent"],
            ondelete="CASCADE",
            name="fk_agent_skills_agent_owner_role",
        ),
        ForeignKeyConstraint(
            ["skill_id", "user_id"],
            ["skills.id", "skills.user_id"],
            ondelete="CASCADE",
            name="fk_agent_skills_skill_owner",
        ),
        Index("idx_agent_skills_skill_owner", "skill_id", "user_id"),
    )
