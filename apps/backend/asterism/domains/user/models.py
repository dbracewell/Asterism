"""SQLAlchemy models for the user domain.

Better Auth remains the source of truth for identity and sign-in. The users
row keeps a display copy of the current name and email (never used to
authenticate; see ADR-0057) and the role stays in the token. The row also
holds the user's one About you text and its revision (ADR-0066).
"""

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.groups.models import STUDENT_GROUP


class UserModel(Base):
    """A user known to Asterism's database.

    The id is shared by owned domains. ``name`` and ``email`` copy the verified
    Better Auth claims for display; they are null only until first known and are
    never blanked. ``created_at`` is when the backend first provisioned the
    user. ``about_md`` is what the user wrote about themselves (empty until
    they write it); every edit bumps ``about_revision``. The user and
    main-agent configuration are committed atomically by
    :func:`asterism.domains.user.service.create_user`.
    """

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("about_revision >= 1", name="user_about_revision_positive"),
        CheckConstraint(
            "length(about_md) <= 16000 AND length(CAST(about_md AS BLOB)) <= 64000", name="user_about_bounds"
        ),
        CheckConstraint("instr(about_md, char(0)) = 0", name="user_about_no_nul"),
        CheckConstraint("name IS NULL OR length(trim(name)) BETWEEN 1 AND 255", name="user_name_bounds"),
        CheckConstraint("email IS NULL OR length(trim(email)) BETWEEN 1 AND 320", name="user_email_bounds"),
    )
    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[int] = mapped_column(
        Integer, default=get_unix_timestamp, server_default=text("(unixepoch())"), nullable=False
    )
    # Exactly one group per user (ADR-0058); new users join Student.
    group_id: Mapped[str] = mapped_column(
        ForeignKey("groups.id", ondelete="RESTRICT"),
        default=STUDENT_GROUP,
        server_default=STUDENT_GROUP,
        nullable=False,
        index=True,
    )
    about_md: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    about_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)


class DeletedUserModel(Base):
    """Tombstone for a user id that has been deleted.

    Written atomically with the ``users`` row deletion so that a deleted
    user cannot be resurrected by their still-valid JWT (which would
    otherwise re-provision them via ``ensure_user``) or by an admin/system-key
    create call. Tombstones are permanent: a deleted id can never be reused,
    which keeps the guarantee simple and auditable.
    """

    __tablename__ = "deleted_users"
    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )
