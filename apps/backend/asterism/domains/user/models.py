"""SQLAlchemy models for the user domain.

Identity details (email, name, role) remain in Better Auth. Users additionally
own persona documents and a non-null default pointer, distinct from agent
configuration. Deferred owner-consistent foreign keys and fresh-schema triggers
enforce persona invariants even for direct SQL.
"""

import uuid

from sqlalchemy import (
    DDL,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin


class UserModel(Base):
    """A user known to Asterism's database.

    The id is shared by owned domains; the default pointer identifies one owned
    persona. Its initial row is created by a transaction-local trigger. The
    user and main-agent configuration are committed atomically by
    :func:`asterism.domains.user.service.create_user`.
    """

    __tablename__ = "users"
    default_persona_id: Mapped[uuid.UUID] = mapped_column(
        default=uuid.uuid4,
        server_default=text("(lower(hex(randomblob(16))))"),
        nullable=False,
    )
    persona_revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    __table_args__ = (
        CheckConstraint("persona_revision >= 1", name="user_persona_revision_positive"),
        ForeignKeyConstraint(
            ["default_persona_id", "id"],
            ["user_personas.id", "user_personas.user_id"],
            name="fk_user_default_persona_owner",
            deferrable=True,
            initially="DEFERRED",
            use_alter=True,
        ),
    )
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


class PersonaProfileModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    """Owned USER.md input; the owner's pointer determines which row is default."""

    __tablename__ = "user_personas"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    user_md: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_persona_id_owner"),
        UniqueConstraint("user_id", "name", name="uq_persona_owner_name"),
        CheckConstraint("revision >= 1", name="persona_revision_positive"),
        CheckConstraint("length(trim(name)) BETWEEN 1 AND 80", name="persona_name_bounds"),
        CheckConstraint(
            "length(user_md) <= 16000 AND length(CAST(user_md AS BLOB)) <= 64000", name="persona_text_bounds"
        ),
        CheckConstraint("instr(user_md, char(0)) = 0", name="persona_text_no_nul"),
    )


# Both service provisioning and direct SQL inserts obey the fresh-schema invariant.
# Metadata ownership keeps these triggers present in isolated create_all fixtures.
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS user_initial_persona
AFTER INSERT ON users BEGIN
  INSERT INTO user_personas(id, user_id, name, user_md, revision, created_at, updated_at)
  VALUES(NEW.default_persona_id, NEW.id, 'Default', '', 1, unixepoch(), unixepoch());
END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS persona_owner_limit
BEFORE INSERT ON user_personas
WHEN (SELECT count(*) FROM user_personas WHERE user_id=NEW.user_id) >= 20
BEGIN SELECT RAISE(ABORT, 'Persona limit reached'); END
""").execute_if(dialect="sqlite"),
)


event.listen(
    Base.metadata,
    "after_create",
    DDL("""
    CREATE TRIGGER IF NOT EXISTS persona_owner_immutable
    BEFORE UPDATE OF user_id ON user_personas WHEN NEW.user_id != OLD.user_id
    BEGIN SELECT RAISE(ABORT, 'Persona ownership is immutable'); END
    """).execute_if(dialect="sqlite"),
)
