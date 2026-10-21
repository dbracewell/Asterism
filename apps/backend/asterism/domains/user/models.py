"""SQLAlchemy models for the user domain.

The ``users`` table is intentionally minimal: it only records which user ids
exist in Asterism's own database. Identity details (email, name, role) live in
the BetterAuth-issued JWT and are never persisted here; this row exists so
other domains can attach rows to a user via ``ForeignKey("users.id")`` with
``ondelete="CASCADE"``.
"""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base


class UserModel(Base):
    """A user known to Asterism's database.

    The single column doubles as the primary key and the stable id used by
    every other domain (chats, files, agent profiles, ...). A row is created
    atomically with the user's main-agent configuration by
    :func:`asterism.domains.user.service.create_user`.
    """

    __tablename__ = "users"
    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )


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
