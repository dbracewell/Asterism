"""Educator requests, classes and membership (ADR-0053, ADR-0058).

Being an educator is membership of the educator group, not a platform role, and
it reaches only the classes that educator created. Nothing here links to a student's chats.
"""

import uuid

from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin

MAX_CLASS_NAME_LENGTH = 120
MAX_CLASS_DESCRIPTION_LENGTH = 2_000
MAX_INVITE_LABEL_LENGTH = 80


class EducatorRequestModel(Base, TimestampMixin):
    """A pending request for educator access (ADR-0058).

    Access itself is membership of the educator group. Approving or denying
    deletes the row. The requester's name and email are read live from ``users``.
    """

    __tablename__ = "educator_requests"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class ClassModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """A class. Its creator is its only educator, whose live name students see."""

    __tablename__ = "classes"

    educator_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(MAX_CLASS_NAME_LENGTH), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    join_code: Mapped[str] = mapped_column(String(16), nullable=False)
    join_enabled: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")
    # Class mode policy (US-60.4): it can only narrow what students may do in
    # their course project. None allows every mode.
    allowed_modes: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    answer_reveal: Mapped[bool] = mapped_column(nullable=False, default=True, server_default="1")

    __table_args__ = (
        UniqueConstraint("educator_id", "name", name="uq_classes_educator_name"),
        UniqueConstraint("join_code", name="uq_classes_join_code"),
        CheckConstraint("length(trim(name)) > 0", name="ck_classes_name"),
        Index("idx_classes_educator", "educator_id", "name"),
    )


class ClassMemberModel(Base, TimestampMixin):
    """A student's place in a class.

    ``removed_at`` keeps a removed student from rejoining with the same code until
    the educator allows it. Leaving a class deletes the row instead. Joining
    shares the student's live name with the educator, and with no one else.
    """

    __tablename__ = "class_members"

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    removed_at: Mapped[int | None] = mapped_column(nullable=True)
    # US-60.5: off until the student opts in; they can withdraw at any time.
    insights_consent: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="0")

    __table_args__ = (Index("idx_class_members_user", "user_id", "class_id"),)


class ClassInviteModel(Base, UuidPrimaryKeyMixin, TimestampMixin):
    """A single-use invite that creates an account and joins one class.

    Only a hash of the token is stored; the educator sees the link once. A claim
    is a conditional update, so exactly one signup can use an invite.
    """

    __tablename__ = "class_invites"

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Who the educator made it for; not proof of who used it.
    label: Mapped[str] = mapped_column(String(MAX_INVITE_LABEL_LENGTH), nullable=False)
    expires_at: Mapped[int] = mapped_column(nullable=False)
    revoked_at: Mapped[int | None] = mapped_column(nullable=True)
    redeemed_at: Mapped[int | None] = mapped_column(nullable=True)
    # Kept when the account is later deleted, so the invite stays used.
    redeemed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # The signup name; shown only once the account is gone (``redeemed_by`` NULL).
    redeemed_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_class_invites_token_hash"),
        CheckConstraint("length(trim(label)) > 0", name="ck_class_invites_label"),
        CheckConstraint("(redeemed_at IS NULL) = (redeemed_name IS NULL)", name="ck_class_invites_redeemed_together"),
        Index("idx_class_invites_class", "class_id", "created_at"),
    )
