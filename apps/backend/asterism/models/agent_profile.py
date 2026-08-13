import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import ForeignKey, Integer, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from asterism.common import ChatCompletionParams
from asterism.models.typedefs import JSONB_COLUMN

if TYPE_CHECKING:
    pass

from .base import Base


class AgentProfileModel(Base):
    __tablename__ = "agent_profiles"
    id: Mapped[uuid.UUID] = mapped_column(
        "id",
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
        index=True,
    )
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
        default=lambda: ChatCompletionParams().__dict__,
    )
    tools: Mapped[Optional[list[str]]] = mapped_column(
        "tools",
        JSONB_COLUMN(),
        nullable=True,
    )
