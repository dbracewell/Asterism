"""Encrypted per-user ChatGPT connections and single-use authorization attempts."""

from enum import StrEnum

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.mixins import TimestampMixin
from asterism.domains.settings.secrets import EncryptedText


class ChatGPTConnectionStatus(StrEnum):
    """Lifecycle state of one user's connection.

    ``CONNECTED`` holds tokens with plan usage granted; ``PLAN_USAGE_DISABLED``
    holds tokens whose grant lacks ``chatgpt.tokens.use.direct``;
    ``REAUTHORIZATION_REQUIRED`` lost its tokens to a terminal refresh error;
    ``DISCONNECTED`` was signed out by the user. The last two keep the issued
    client ID and verified identity for a later sign-in.
    """

    CONNECTED = "connected"
    PLAN_USAGE_DISABLED = "plan_usage_disabled"
    REAUTHORIZATION_REQUIRED = "reauthorization_required"
    DISCONNECTED = "disconnected"


class ChatGPTConnectionModel(Base, TimestampMixin):
    """One user's ChatGPT registration and tokens; secrets are encrypted at rest.

    ``token_revision`` increments on every token write so a refresh only
    commits over the exact token set it started from.
    """

    __tablename__ = "chatgpt_connections"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[ChatGPTConnectionStatus] = mapped_column(
        Enum(
            ChatGPTConnectionStatus,
            values_callable=lambda members: [member.value for member in members],
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            length=32,
            name="chatgpt_connection_status",
        ),
        nullable=False,
    )
    client_id: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    host_id: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    subject: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    email: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    id_token: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    access_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    expires_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scopes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    token_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Set when a usage limit paused plan requests; cleared by the user.
    usage_paused_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # When the one-time "You're using your ChatGPT plan" notice was dismissed.
    notice_dismissed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        CheckConstraint("token_revision >= 1", name="ck_chatgpt_connections_token_revision"),
        CheckConstraint(
            "(access_token IS NULL) = (refresh_token IS NULL) AND (access_token IS NULL) = (expires_at IS NULL)",
            name="ck_chatgpt_connections_token_set",
        ),
        CheckConstraint(
            "(status IN ('connected', 'plan_usage_disabled')) = (access_token IS NOT NULL)",
            name="ck_chatgpt_connections_status_tokens",
        ),
    )


class ChatGPTAuthorizationModel(Base, TimestampMixin):
    """A pending authorization attempt, consumed exactly once by its callback.

    Only a SHA-256 digest of ``state`` is stored, so a database read cannot
    forge a callback. ``client_id`` is the issued ID for reauthorization and
    NULL for a new dynamic registration.
    """

    __tablename__ = "chatgpt_authorizations"

    state_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_id: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    code_verifier: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    nonce: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (Index("idx_chatgpt_authorizations_user", "user_id"),)


class ChatGPTHostModel(Base):
    """The installation's stable, opaque ``ext_agent_host_id`` (single row)."""

    __tablename__ = "chatgpt_host"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    host_id: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (CheckConstraint("id = 1", name="ck_chatgpt_host_singleton"),)
