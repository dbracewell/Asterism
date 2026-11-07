"""Published course versions and each student's copy of one.

A version is an immutable snapshot: a validated team pack, the educator's model
for each sub-agent, and the course files. A student's copy is ordinary records
they own; ``course_copy_items`` remembers which records came from which course
item, so an update can change them in place. Nothing here grants access to the
educator's records.
"""

import uuid
from enum import StrEnum

from sqlalchemy import (
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common.enums import enum_values
from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

MAX_COURSE_NOTE_LENGTH = 2_000


class CourseVersionModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "course_versions"

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # The pack JSON, parsed again (and so re-screened) whenever it is read.
    manifest: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON object of sub-agent key to model id. Models are shared by the whole
    # instance, so students get the educator's choice when it's available to them.
    models: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (UniqueConstraint("class_id", "number", name="uq_course_versions_class_number"),)


class CourseFileModel(Base, UuidPrimaryKeyMixin):
    """A file in a version. Only the latest version keeps its bytes."""

    __tablename__ = "course_files"

    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    # In the educator's file-store shard; cleared when a newer version supersedes it.
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("version_id", "name", name="uq_course_files_version_name"),)


class CourseCopyModel(Base, TimestampMixin):
    """A student's copy of a class's course, at the version they last applied."""

    __tablename__ = "course_copies"

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("course_versions.id", ondelete="CASCADE"), nullable=False)
    # The student may delete their project; adding the course again recreates it.
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)


class CourseItemType(StrEnum):
    SUB_AGENT = "sub_agent"
    FILE = "file"


class CourseCopyItemModel(Base):
    """Which of the student's records a course item became.

    ``record_id`` is not a foreign key: the student may delete the record, and
    the next update then creates it again.
    """

    __tablename__ = "course_copy_items"

    class_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(primary_key=True)
    item_type: Mapped[CourseItemType] = mapped_column(
        Enum(CourseItemType, values_callable=enum_values, native_enum=False, create_constraint=True),
        primary_key=True,
    )
    item_key: Mapped[str] = mapped_column(String(255), primary_key=True)
    record_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    # Files only: the content the record was made from.
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["class_id", "user_id"],
            ["course_copies.class_id", "course_copies.user_id"],
            ondelete="CASCADE",
            name="fk_course_copy_items_copy",
        ),
        Index("idx_course_copy_items_record", "record_id"),
    )
