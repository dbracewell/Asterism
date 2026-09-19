import uuid
from typing import Any, Optional

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.columns import JSONB_COLUMN
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from asterism.domains.llm.schemas import ChatCompletionParams


class AgentProfileModel(Base, UuidPrimaryKeyMixin):
    __tablename__ = "agent_profiles"
    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    model_id: Mapped[uuid.UUID] = mapped_column(
        "model_id",
        ForeignKey("models.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    sub_agent: Mapped[bool] = mapped_column(
        "sub_agent",
        nullable=False,
        default=False,
    )
    name: Mapped[str] = mapped_column(
        "name",
        Text,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        "description",
        Text,
        nullable=False,
    )
    system_prompt: Mapped[Optional[str]] = mapped_column(
        "system_prompt",
        Text,
        nullable=True,
    )
    max_steps: Mapped[int] = mapped_column(
        "max_steps",
        Integer,
        nullable=False,
        default=5,
    )
    chat_parameters: Mapped[ChatCompletionParams] = mapped_column(
        "chat_parameters",
        JSONB_COLUMN(),
        nullable=False,
        default=dict,
    )
    tools: Mapped[Optional[list[str]]] = mapped_column(
        "tools",
        JSONB_COLUMN(),
        nullable=True,
    )


class SubAgentTraceModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "sub_agent_traces"

    user_id: Mapped[str] = mapped_column(
        "user_id",
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    parent_message_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        "parent_message_id",
        ForeignKey("messages.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    sub_agent_id: Mapped[uuid.UUID] = mapped_column(
        "sub_agent_id",
        ForeignKey("agent_profiles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    sub_agent_name: Mapped[str] = mapped_column(
        "sub_agent_name",
        Text,
        nullable=False,
    )
    prompt: Mapped[str] = mapped_column(
        "prompt",
        Text,
        nullable=False,
    )
    caller_context: Mapped[Optional[str]] = mapped_column(
        "caller_context",
        Text,
        nullable=True,
    )
    messages: Mapped[list[dict[str, Any]]] = mapped_column(
        "messages",
        JSONB_COLUMN(),
        nullable=False,
        default=list,
    )
    result: Mapped[Optional[str]] = mapped_column(
        "result",
        Text,
        nullable=True,
    )
    step_count: Mapped[int] = mapped_column(
        "step_count",
        Integer,
        nullable=False,
        default=0,
    )
    total_tokens: Mapped[int] = mapped_column(
        "total_tokens",
        Integer,
        nullable=False,
        default=0,
    )
    elapsed_ms: Mapped[int] = mapped_column(
        "elapsed_ms",
        Integer,
        nullable=False,
        default=0,
    )
    depth: Mapped[int] = mapped_column(
        "depth",
        Integer,
        nullable=False,
        default=0,
    )
