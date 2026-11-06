"""Immutable execution inputs; messages reference one owner-consistent record."""

import uuid

from pydantic import TypeAdapter
from sqlalchemy import DDL, ForeignKey, ForeignKeyConstraint, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column

from asterism.db.base_model import Base
from asterism.db.columns import jsonb_type
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.agent.instruction_overrides import InstructionOverride
from asterism.domains.agent.prompts import PromptSnapshot

from .schemas import MessageExecution


class ChatExecutionModel(Base):
    __tablename__ = "chat_executions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    chat_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True)
    request_message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    execution: Mapped[MessageExecution] = mapped_column(jsonb_type(TypeAdapter(MessageExecution)), nullable=False)
    prompt: Mapped[PromptSnapshot] = mapped_column(jsonb_type(TypeAdapter(PromptSnapshot)), nullable=False)
    # Private fork instructions (US-54.5); public provenance holds their digests.
    instruction_overrides: Mapped[list[InstructionOverride]] = mapped_column(
        jsonb_type(TypeAdapter(list[InstructionOverride])), nullable=False, default=list
    )
    created_at: Mapped[int] = mapped_column(default=get_unix_timestamp)
    __table_args__ = (
        UniqueConstraint("id", "chat_id", "user_id", name="uq_execution_id_chat_user"),
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chats.id", "chats.user_id"],
            name="fk_execution_chat_owner",
        ),
        ForeignKeyConstraint(
            ["request_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_execution_request_owner",
        ),
    )


event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS chat_execution_immutable
BEFORE UPDATE ON chat_executions
BEGIN SELECT RAISE(ABORT, 'Execution records are immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS accepted_persona_immutable
BEFORE UPDATE OF accepted_persona ON messages
WHEN NEW.accepted_persona IS NOT OLD.accepted_persona
BEGIN SELECT RAISE(ABORT, 'Accepted persona input is immutable'); END
""").execute_if(dialect="sqlite"),
)

event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS accepted_learning_mode_immutable
BEFORE UPDATE OF accepted_learning_mode ON messages
WHEN NEW.accepted_learning_mode IS NOT OLD.accepted_learning_mode
BEGIN SELECT RAISE(ABORT, 'Accepted learning mode input is immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS hint_level_immutable
BEFORE UPDATE OF hint_level ON messages
WHEN NEW.hint_level IS NOT OLD.hint_level
BEGIN SELECT RAISE(ABORT, 'Accepted hint level is immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS accepted_template_immutable
BEFORE UPDATE OF accepted_template ON messages
WHEN NEW.accepted_template IS NOT OLD.accepted_template
BEGIN SELECT RAISE(ABORT, 'Accepted template provenance is immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS accepted_goal_immutable
BEFORE UPDATE OF accepted_goal ON messages
WHEN NEW.accepted_goal IS NOT OLD.accepted_goal
BEGIN SELECT RAISE(ABORT, 'Accepted learning goal is immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS accepted_rubric_immutable
BEFORE UPDATE OF accepted_rubric ON messages
WHEN NEW.accepted_rubric IS NOT OLD.accepted_rubric
BEGIN SELECT RAISE(ABORT, 'Accepted rubric input is immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS accepted_skills_immutable
BEFORE UPDATE OF accepted_skills ON messages
WHEN NEW.accepted_skills IS NOT OLD.accepted_skills
BEGIN SELECT RAISE(ABORT, 'Accepted skill inputs are immutable'); END
""").execute_if(dialect="sqlite"),
)
event.listen(
    Base.metadata,
    "after_create",
    DDL("""
CREATE TRIGGER IF NOT EXISTS comparison_column_immutable
BEFORE UPDATE OF comparison_id, comparison_index, target_model_id, comparison_label ON messages
WHEN OLD.comparison_id IS NOT NULL AND (
  NEW.comparison_id IS NOT OLD.comparison_id
  OR NEW.comparison_index IS NOT OLD.comparison_index
  OR NEW.target_model_id IS NOT OLD.target_model_id
  OR NEW.comparison_label IS NOT OLD.comparison_label
)
BEGIN SELECT RAISE(ABORT, 'Comparison columns are immutable'); END
""").execute_if(dialect="sqlite"),
)
