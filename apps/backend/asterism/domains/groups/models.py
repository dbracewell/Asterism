"""User groups (ADR-0058): every user is in exactly one group.

The three built-in groups are seeded when the table is created, with fixed ids,
so code refers to them directly. They can't be renamed or deleted.
"""

import uuid

from sqlalchemy import DDL, JSON, CheckConstraint, Index, String, event, func
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin

ADMIN_GROUP = "admin"
EDUCATOR_GROUP = "educator"
STUDENT_GROUP = "student"
BUILT_IN_GROUPS = {ADMIN_GROUP: "Admin", EDUCATOR_GROUP: "Educator", STUDENT_GROUP: "Student"}
MAX_GROUP_NAME_LENGTH = 80


def new_group_id() -> str:
    return uuid.uuid4().hex


class GroupModel(Base, TimestampMixin):
    """A group of users. Access settings attach here (US-70.2)."""

    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_group_id)
    name: Mapped[str] = mapped_column(String(MAX_GROUP_NAME_LENGTH), nullable=False)
    built_in: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="0")
    # US-70.2: None allows every model or tool the administrator enabled, now and
    # later; a list allows only those ids or tool names. Stale entries are ignored.
    model_access: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    tool_access: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        CheckConstraint(f"length(trim(name)) BETWEEN 1 AND {MAX_GROUP_NAME_LENGTH}", name="ck_groups_name"),
        Index("uq_groups_name_lower", func.lower(name), unique=True),
    )


_seed = ", ".join(f"('{key}', '{name}', 1, unixepoch(), unixepoch())" for key, name in BUILT_IN_GROUPS.items())
event.listen(
    GroupModel.__table__,
    "after_create",
    DDL(f"INSERT INTO groups (id, name, built_in, created_at, updated_at) VALUES {_seed}"),
)
