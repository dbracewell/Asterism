import uuid
from typing import Any, Optional

from pydantic import TypeAdapter
from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from asterism.domains.llm.schemas import ChatCompletionParams

from .prompts import PromptProvenance


class AgentProfileModel(Base, UuidPrimaryKeyMixin):
    __tablename__ = "agent_profiles"
    __table_args__ = (
        UniqueConstraint("id", "user_id", "sub_agent", name="uq_agent_profile_id_owner_role"),
        CheckConstraint(
            "(sub_agent = false AND model_id IS NULL) OR (sub_agent = true AND model_id IS NOT NULL)",
            name="agent_role_model",
        ),
        CheckConstraint("config_revision >= 1", name="agent_config_revision_positive"),
        CheckConstraint("max_steps >= 1 AND max_steps <= 100", name="agent_loop_limit"),
        Index(
            "one_main_agent_per_user",
            "user_id",
            unique=True,
            sqlite_where=text("sub_agent = false"),
            postgresql_where=text("sub_agent = false"),
        ),
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("models.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    sub_agent: Mapped[bool] = mapped_column(
        nullable=False,
        default=False,
    )
    name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    system_prompt: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
    )
    config_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    max_steps: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=5,
    )
    chat_parameters: Mapped[ChatCompletionParams] = mapped_column(
        JSONB_COLUMN(),
        nullable=False,
        default=dict,
    )
    tools: Mapped[list[str]] = mapped_column(
        JSONB_COLUMN(),
        nullable=False,
        default=list,
    )


class SubAgentTraceModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "sub_agent_traces"
    prompt_provenance: Mapped[PromptProvenance | None] = mapped_column(
        JSONB_COLUMN(TypeAdapter(PromptProvenance)),
        nullable=True,
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    parent_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    sub_agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_profiles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    sub_agent_name: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    prompt: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    caller_context: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    messages: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB_COLUMN(),
        nullable=False,
        default=list,
    )
    result: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    step_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    total_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    elapsed_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    depth: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
