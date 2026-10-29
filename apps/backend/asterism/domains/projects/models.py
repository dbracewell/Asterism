"""Project metadata and owner-consistent references to independently stored files."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

# Named colors a project may show in the sidebar; the frontend maps each to a swatch.
PROJECT_ACCENTS = ("red", "orange", "amber", "green", "teal", "sky", "violet", "pink")


class ProjectModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """A user-owned project: metadata plus a ``context_revision`` optimistic token.

    The revision is bumped only when the *execution context* changes — i.e. the
    file membership or ``system_prompt`` changes. Pure metadata edits (name,
    description, accent) deliberately do not advance it, so clients can retry metadata
    updates without re-reading after unrelated churn. Membership and prompt
    writers compare-and-set on this column to detect concurrent context changes.
    """

    __tablename__ = "projects"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # Optional sidebar color from the fixed PROJECT_ACCENTS palette; metadata only.
    accent: Mapped[str | None] = mapped_column(String(16), nullable=True)
    context_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_projects_user_name"),
        # Redundant with the primary key on its own, but required so child tables
        # can reference (id, user_id) as a composite foreign key on any backend.
        UniqueConstraint("id", "user_id", name="uq_projects_id_user"),
        CheckConstraint("length(trim(name)) > 0 AND length(name) <= 255", name="ck_projects_name"),
        CheckConstraint("context_revision >= 1", name="ck_projects_context_revision"),
        CheckConstraint(
            f"accent IS NULL OR accent IN ({', '.join(repr(accent) for accent in PROJECT_ACCENTS)})",
            name="ck_projects_accent",
        ),
        Index("idx_projects_user_updated", "user_id", "updated_at"),
    )


class ProjectFileModel(Base, TimestampMixin):
    """Unordered membership; deleting it never deletes source or knowledge data."""

    __tablename__ = "project_files"

    project_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    # Denormalized owner, not a standalone FK: it exists so both composite
    # foreign keys can pin the row to one user and cascade on project/file/
    # user deletion without touching source files or knowledge data.
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


class ProjectSubAgentModel(Base, TimestampMixin):
    """A selection grants delegation eligibility only; role and owner are DB-enforced."""

    __tablename__ = "project_sub_agents"

    project_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    # Denormalized owner, mirroring ProjectFileModel.user_id for the composite FKs.
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    # Constant-true role flag: SQL foreign keys cannot reference a column set
    # with a literal value, so this column carries the ``sub_agent = true``
    # constant into the composite FK (and is pinned by ck_project_sub_agent_role).
    sub_agent: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")

    __table_args__ = (
        CheckConstraint("sub_agent = true", name="ck_project_sub_agent_role"),
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            ondelete="CASCADE",
            name="fk_project_sub_agents_project_owner",
        ),
        ForeignKeyConstraint(
            ["agent_id", "user_id", "sub_agent"],
            ["agent_profiles.id", "agent_profiles.user_id", "agent_profiles.sub_agent"],
            ondelete="CASCADE",
            name="fk_project_sub_agents_agent_owner_role",
        ),
        Index("idx_project_sub_agents_agent_owner", "agent_id", "user_id"),
    )
