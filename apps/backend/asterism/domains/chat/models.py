import uuid

from pydantic import TypeAdapter
from sqlalchemy import (
    UUID,
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from asterism.common.enums import enum_values
from asterism.core.config import default_allowed_tools
from asterism.db.base_model import Base
from asterism.db.columns import jsonb_type
from asterism.db.mixins import TimestampMixin, UuidPrimaryKeyMixin
from asterism.domains.agent.context_manifest import ContextManifest
from asterism.domains.agent.execution_scope import ChatPurpose
from asterism.domains.agent.learning_inputs import (
    HintLevel,
    LearningModeId,
    LearningModeProvenance,
    LearningModeSnapshot,
)
from asterism.domains.agent.prompts import PersonaSnapshot, PromptSnapshot
from asterism.domains.agent.skill_inputs import AcceptedSkills, SkillIdentity
from asterism.domains.llm.schemas import ToolCall, ToolResult
from asterism.domains.projects.goals import GoalSnapshot
from asterism.domains.prompt_templates.provenance import TemplateLabel, TemplateProvenance
from asterism.domains.prompt_templates.rubric_provenance import RubricLabel, RubricSnapshot

from .citation_schemas import SpanCitation
from .disagreement_schemas import DisagreementSummary
from .draft_comment_schemas import DraftComments, DraftCommentSummary, comment_summary
from .execution_models import ChatExecutionModel
from .exercise_schemas import ExerciseRecord, ExerciseView, exercise_view
from .schemas import (
    ChatModelChoice,
    DelegationRecord,
    InlineFileReference,
    MessageExecution,
    MessageFileReference,
    MessageStatus,
)
from .verification_schemas import MessageVerification


class ChatModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "chats"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    persona_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    skill_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    persona_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # Current learning-mode selection; accepted turns pin their own snapshot.
    learning_mode: Mapped[LearningModeId] = mapped_column(
        Enum(LearningModeId, values_callable=enum_values, native_enum=False, create_constraint=True),
        nullable=False,
        default=LearningModeId.STANDARD,
    )
    learning_mode_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # Self-imposed lock (US-52.5): leaving the mode or revealing needs an override.
    learning_mode_locked: Mapped[bool] = mapped_column(
        Boolean(create_constraint=True, name="ck_chats_learning_mode_locked_boolean"),
        nullable=False,
        default=False,
        server_default="0",
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    agent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_profiles.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    # Retain unavailable/deleted selections instead of retargeting the chat.
    selected_model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    selected_model_snapshot: Mapped[ChatModelChoice | None] = mapped_column(
        jsonb_type(TypeAdapter(ChatModelChoice)),
        nullable=True,
    )
    model_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Which root turn the active branch starts from; None means the oldest root.
    # Only comparisons create sibling roots (US-54.4).
    active_root_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    title: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )
    allowed_tools: Mapped[list[str]] = mapped_column(
        jsonb_type(TypeAdapter(list[str])),
        nullable=False,
        default=default_allowed_tools,
    )
    # Set once by the server (ADR-0061); hidden chats are never listed.
    purpose: Mapped[ChatPurpose] = mapped_column(
        String(20), nullable=False, default="conversation", server_default="conversation"
    )

    __table_args__ = (
        CheckConstraint("purpose IN ('conversation', 'skill_draft')", name="chat_purpose_known"),
        CheckConstraint("skill_revision >= 0", name="chat_skill_revision_nonnegative"),
        CheckConstraint("model_revision >= 1", name="chat_model_revision_positive"),
        CheckConstraint("persona_revision >= 1", name="chat_persona_revision_positive"),
        CheckConstraint("learning_mode_revision >= 1", name="chat_learning_mode_revision_positive"),
        CheckConstraint(
            "NOT learning_mode_locked OR learning_mode != 'standard'",
            name="chat_standard_mode_unlocked",
        ),
        ForeignKeyConstraint(
            ["persona_id", "user_id"],
            ["user_personas.id", "user_personas.user_id"],
            name="fk_chat_persona_owner",
        ),
        UniqueConstraint("id", "user_id", name="uq_chats_id_user"),
        ForeignKeyConstraint(
            ["project_id", "user_id"],
            ["projects.id", "projects.user_id"],
            name="fk_chats_project_owner",
        ),
    )


class MessageModel(Base, TimestampMixin, UuidPrimaryKeyMixin):
    __tablename__ = "messages"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID,
        ForeignKey(
            "chats.id",
            ondelete="CASCADE",
            name="message_fk_session_id",
        ),
        nullable=False,
        index=True,
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        nullable=True,
    )
    execution_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "chat_executions.id", name="fk_message_execution", use_alter=True, deferrable=True, initially="DEFERRED"
        ),
        nullable=True,
        index=True,
    )
    pending_execution_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "chat_executions.id",
            name="fk_message_pending_execution",
            use_alter=True,
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
        index=True,
    )
    accepted_skills: Mapped[AcceptedSkills] = mapped_column(
        jsonb_type(TypeAdapter(AcceptedSkills)),
        nullable=False,
        default=AcceptedSkills,
    )
    accepted_persona: Mapped[PersonaSnapshot | None] = mapped_column(
        jsonb_type(TypeAdapter(PersonaSnapshot)),
        nullable=True,
    )
    # Private pinned learning-mode instructions; set on user turns only.
    accepted_learning_mode: Mapped[LearningModeSnapshot | None] = mapped_column(
        jsonb_type(TypeAdapter(LearningModeSnapshot)),
        nullable=True,
    )
    # Branch-local hint state after this user turn; later turns on the branch
    # carry it forward until the learner raises or resets it.
    hint_level: Mapped[HintLevel] = mapped_column(
        Enum(HintLevel, values_callable=enum_values, native_enum=False, create_constraint=True),
        nullable=False,
        default=HintLevel.NONE,
        server_default=HintLevel.NONE.value,
    )
    # Label-only record of the template that built this prompt; never inherited.
    accepted_template: Mapped[TemplateProvenance | None] = mapped_column(
        jsonb_type(TypeAdapter(TemplateProvenance)),
        nullable=True,
    )
    # The rubric a Draft feedback turn is assessed against (US-57.1); pinned at
    # acceptance, immutable, and reused by resume and regeneration.
    accepted_rubric: Mapped[RubricSnapshot | None] = mapped_column(
        jsonb_type(TypeAdapter(RubricSnapshot)),
        nullable=True,
    )
    # The project learning goal the learner included in this turn (US-58.1);
    # pinned at acceptance and immutable.
    accepted_goal: Mapped[GoalSnapshot | None] = mapped_column(
        jsonb_type(TypeAdapter(GoalSnapshot)),
        nullable=True,
    )
    # US-54.4: a user turn that is one column of a side-by-side comparison.
    # Columns are sibling turns sharing ``comparison_id``; each runs on its
    # fixed ``target_model_id``. Set once, then immutable (SQLite trigger).
    comparison_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    comparison_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_model_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    # Optional heading such as "Before"/"After" (US-51.7); the model name otherwise.
    comparison_label: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[MessageStatus] = mapped_column(
        Enum(
            MessageStatus,
            values_callable=enum_values,
            native_enum=False,
            create_constraint=True,
        ),
        nullable=False,
        default=MessageStatus.PENDING,
    )
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    active_child_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(
        String,
        nullable=False,
    )
    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    thinking: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default="",
    )
    tool_calls: Mapped[list[ToolCall] | None] = mapped_column(
        jsonb_type(TypeAdapter(list[ToolCall])),
        nullable=True,
    )
    tool_call_results: Mapped[list[ToolResult | None]] = mapped_column(
        jsonb_type(TypeAdapter(list[ToolResult])),
        nullable=True,
    )
    # Sub-agent delegations run by this step's tool calls (history display only).
    delegations: Mapped[list[DelegationRecord] | None] = mapped_column(
        jsonb_type(TypeAdapter(list[DelegationRecord])),
        nullable=True,
    )
    # Context manifest of an assistant step: references and reasons only (US-54.3).
    context: Mapped[ContextManifest | None] = mapped_column(
        jsonb_type(TypeAdapter(ContextManifest)),
        nullable=True,
    )
    files: Mapped[list[MessageFileReference]] = mapped_column(
        jsonb_type(TypeAdapter(list[MessageFileReference])),
        nullable=False,
        default=list,
    )
    # Server-resolved ``asterism-file:`` references in ``content`` (ADR-0039).
    inline_files: Mapped[list[InlineFileReference]] = mapped_column(
        jsonb_type(TypeAdapter(list[InlineFileReference])),
        nullable=False,
        default=list,
    )
    # Spot-the-error record (US-55.4, ADR-0043); private until revealed.
    exercise_record: Mapped[ExerciseRecord | None] = mapped_column(
        jsonb_type(TypeAdapter(ExerciseRecord)),
        nullable=True,
    )
    # Inline comments parsed from a Draft feedback reply (US-57.2, ADR-0045);
    # only their resolved state changes after the reply is saved.
    draft_comments: Mapped[DraftComments | None] = mapped_column(
        jsonb_type(TypeAdapter(DraftComments)),
        nullable=True,
    )
    # The latest disagreement pass anchored on this message (US-55.3, ADR-0042).
    disagreements: Mapped[DisagreementSummary | None] = mapped_column(
        jsonb_type(TypeAdapter(DisagreementSummary)),
        nullable=True,
    )
    # The latest verify pass of this answer (US-55.2, ADR-0041).
    verification: Mapped[MessageVerification | None] = mapped_column(
        jsonb_type(TypeAdapter(MessageVerification)),
        nullable=True,
    )
    # Server-resolved ``asterism-cite:`` claim citations in ``content`` (ADR-0040).
    citations: Mapped[list[SpanCitation]] = mapped_column(
        jsonb_type(TypeAdapter(list[SpanCitation])),
        nullable=False,
        default=list,
    )
    input_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    total_tokens: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    generation_duration_ms: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    __table_args__ = (
        UniqueConstraint("id", "chat_id", "user_id", name="uq_messages_id_chat_user"),
        UniqueConstraint("comparison_id", "comparison_index", name="uq_messages_comparison_column"),
        CheckConstraint(
            "(comparison_id IS NULL AND comparison_index IS NULL AND target_model_id IS NULL"
            " AND comparison_label IS NULL)"
            " OR (comparison_id IS NOT NULL AND role = 'user' AND target_model_id IS NOT NULL"
            " AND comparison_index BETWEEN 0 AND 2)",
            name="message_comparison_column_shape",
        ),
        ForeignKeyConstraint(
            ["execution_id", "chat_id", "user_id"],
            ["chat_executions.id", "chat_executions.chat_id", "chat_executions.user_id"],
            name="fk_message_execution_owner",
            use_alter=True,
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["pending_execution_id", "chat_id", "user_id"],
            ["chat_executions.id", "chat_executions.chat_id", "chat_executions.user_id"],
            name="fk_message_pending_execution_owner",
            use_alter=True,
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chats.id", "chats.user_id"],
            ondelete="CASCADE",
            name="fk_messages_chat_owner",
        ),
        ForeignKeyConstraint(
            ["parent_message_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_messages_parent_scope",
        ),
        ForeignKeyConstraint(
            ["active_child_id", "chat_id", "user_id"],
            ["messages.id", "messages.chat_id", "messages.user_id"],
            name="fk_messages_active_child_scope",
        ),
    )

    execution_record: Mapped[ChatExecutionModel | None] = relationship(
        ChatExecutionModel,
        foreign_keys=[execution_id, chat_id, user_id],
        lazy="selectin",
        viewonly=True,
    )

    pending_execution_record: Mapped[ChatExecutionModel | None] = relationship(
        ChatExecutionModel,
        foreign_keys=[pending_execution_id, chat_id, user_id],
        lazy="selectin",
        viewonly=True,
    )

    @property
    def skills(self) -> list[SkillIdentity]:
        execution = self.execution
        return execution.skills if execution is not None else [item.identity for item in self.accepted_skills.snapshots]

    @property
    def learning_mode(self) -> LearningModeProvenance | None:
        execution = self.execution
        if execution is not None:
            return execution.learning_mode
        accepted = self.accepted_learning_mode
        return accepted.identity if accepted is not None else None

    @property
    def exercise(self) -> ExerciseView | None:
        """The learner's view; the recorded error stays hidden until revealed."""
        return exercise_view(self.exercise_record)

    @property
    def draft_comment_summary(self) -> DraftCommentSummary | None:
        return comment_summary(self.draft_comments)

    @property
    def template(self) -> TemplateLabel | None:
        accepted = self.accepted_template
        return TemplateLabel(**accepted.model_dump()) if accepted is not None else None

    @property
    def goal(self) -> GoalSnapshot | None:
        return self.accepted_goal

    @property
    def rubric(self) -> RubricLabel | None:
        accepted = self.accepted_rubric
        return RubricLabel(**accepted.model_dump()) if accepted is not None else None

    @property
    def execution(self) -> MessageExecution | None:
        record = self.execution_record if self.execution_id is not None else None
        return record.execution.model_copy(deep=True) if record else None

    @property
    def pending_execution(self) -> MessageExecution | None:
        record = self.pending_execution_record if self.pending_execution_id is not None else None
        return record.execution.model_copy(deep=True) if record else None

    @property
    def pending_prompt(self) -> PromptSnapshot | None:
        record = self.pending_execution_record if self.pending_execution_id is not None else None
        return record.prompt.model_copy(deep=True) if record else None

    active_child: Mapped["MessageModel | None"] = relationship(
        "MessageModel",
        foreign_keys=[active_child_id],
        remote_side="MessageModel.id",
        post_update=True,
    )


class ChatFileModel(Base, TimestampMixin):
    """Explicit local source references; active-branch provenance narrows this set."""

    __tablename__ = "chat_files"
    chat_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["chat_id", "user_id"],
            ["chats.id", "chats.user_id"],
            ondelete="CASCADE",
            name="fk_chat_files_chat_owner",
        ),
        ForeignKeyConstraint(
            ["file_id", "user_id"],
            ["user_files.id", "user_files.user_id"],
            ondelete="CASCADE",
            name="fk_chat_files_file_owner",
        ),
        Index("idx_chat_files_file_owner", "file_id", "user_id"),
    )
