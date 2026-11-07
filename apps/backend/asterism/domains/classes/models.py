"""Educator access, classes and membership (ADR-0053).

Being an educator is a grant recorded here, not a platform role, and it reaches
only the classes that educator created. Nothing here links to a student's chats.
"""

import uuid
from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

MAX_CLASS_NAME_LENGTH = 120
MAX_CLASS_DESCRIPTION_LENGTH = 2_000


class EducatorStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"


class EducatorModel(Base, TimestampMixin):
    """A request for, or grant of, educator access.

    Better Auth owns identity and this database cannot list users, so the name and
    email come from the requester's own token, for the administrator to recognize.
    Denying or revoking deletes the row.
    """

    __tablename__ = "educators"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[EducatorStatus] = mapped_column(
        Enum(EducatorStatus, values_callable=enum_values, native_enum=False, create_constraint=True),
        nullable=False,
    )
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    decided_by: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (Index("idx_educators_status_created", "status", "created_at"),)


class ClassModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """A class. Its creator is its only educator."""

    __tablename__ = "classes"

    educator_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # Snapshot, because the backend has no names; students see who runs the class.
    educator_name: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(String(MAX_CLASS_NAME_LENGTH), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    join_code: Mapped[str] = mapped_column(String(16), nullable=False)
    join_enabled: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")

    __table_args__ = (
        UniqueConstraint("educator_id", "name", name="uq_classes_educator_name"),
        UniqueConstraint("join_code", name="uq_classes_join_code"),
        CheckConstraint("length(trim(name)) > 0", name="ck_classes_name"),
        Index("idx_classes_educator", "educator_id", "name"),
    )


class ClassMemberModel(Base, TimestampMixin):
    """A student's place in a class.

    ``removed_at`` keeps a removed student from rejoining with the same code until
    the educator allows it. Leaving a class deletes the row instead.
    """

    __tablename__ = "class_members"

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # The only student detail stored; shared knowingly by joining.
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    removed_at: Mapped[int | None] = mapped_column(nullable=True)

    __table_args__ = (Index("idx_class_members_user", "user_id", "class_id"),)
