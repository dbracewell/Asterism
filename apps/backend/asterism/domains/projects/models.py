"""Project metadata and owner-consistent references to independently stored files."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class ProjectModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "projects"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    context_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_projects_user_name"),
        UniqueConstraint("id", "user_id", name="uq_projects_id_user"),
        CheckConstraint("length(trim(name)) > 0 AND length(name) <= 255", name="ck_projects_name"),
        CheckConstraint("context_revision >= 1", name="ck_projects_context_revision"),
        Index("idx_projects_user_updated", "user_id", "updated_at"),
    )


class ProjectFileModel(Base, TimestampMixin):
    """Unordered membership; deleting it never deletes source or extraction data."""

    __tablename__ = "project_files"

    project_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_project_files_project_owner",
        ),
        ForeignKeyConstraint(
            ["file_id", "user_id"],
            ["user_files.id", "user_files.user_id"],
            ondelete="CASCADE",
            name="fk_project_files_file_owner",
        ),
        Index("idx_project_files_file_owner", "file_id", "user_id"),
    )
