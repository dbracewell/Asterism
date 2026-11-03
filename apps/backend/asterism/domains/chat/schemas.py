from __future__ import annotations

import uuid
from enum import StrEnum, auto
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from asterism.domains.agent.capabilities import CapabilityManifest
from asterism.domains.agent.context_manifest import ContextManifest
from asterism.domains.agent.context_provenance import ContextProvenance
from asterism.domains.agent.instruction_overrides import MAX_OVERRIDE_CHARS, InstructionOverrideProvenance
from asterism.domains.agent.learning_inputs import HintLevel, LearningModeId, LearningModeProvenance
from asterism.domains.agent.prompts import LayerKind, PersonaProvenance, PromptProvenance
from asterism.domains.agent.schemas import MainAgentConfiguration
from asterism.domains.agent.skill_inputs import SkillIdentity
from asterism.domains.files.models import FileContentStatus, FileKind
from asterism.domains.llm.schemas import LLMMessage, ToolCall, ToolResult
from asterism.domains.prompt_templates.provenance import TemplateLabel, TemplateUse
from asterism.domains.settings.pricing import ModelPricing
from asterism.domains.settings.provider_types import ModelCapabilitySource, ProviderType

from .citation_schemas import SpanCitation
from .disagreement_schemas import DisagreementSummary
from .exercise_schemas import ExerciseView
from .verification_schemas import MessageVerification


class MessageStatus(StrEnum):
    PENDING = auto()
    COMPLETED = auto()
    CANCELLED = auto()


DelegationStatus = Literal["running", "completed", "error", "cancelled"]


class UsageStep(BaseModel):
    """Provider-reported usage of one model call (0 when the provider reported none)."""

    model_config = ConfigDict(extra="forbid")
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    generation_duration_ms: int = Field(default=0, ge=0)


class InlineFileReference(BaseModel):
    """One ``asterism-file:`` reference in saved Markdown, resolved at save time (ADR-0039).

    Unavailable references carry only ``file_id``: no role, name, type or size is
    ever recorded or returned for them, so a foreign or guessed ID reveals nothing
    a missing ID would not. ``available`` is rechecked against live scope on read.
    """

    model_config = ConfigDict(extra="forbid")
    file_id: uuid.UUID
    available: bool
    role: Literal["produced", "referenced"] | None = None
    producing_execution_id: uuid.UUID | None = None
    name: str | None = None
    mime_type: str | None = None
    kind: FileKind | None = None
    size: int | None = Field(default=None, ge=0)


class DelegationRecord(BaseModel):
    """One sub-agent delegation observed during an assistant step.

    Persisted on the assistant message whose tool calls ran it, for history
    display only: identity, the fixed model that ran, timing, the child's own
    tool calls and results, and its output or error. Thinking and prompts are not kept.
    ``steps`` is the usage of each of the child's model calls, and
    ``provider_type``/``pricing`` the model's usage provenance, all as recorded
    at execution time (US-54.1).
    ``tool_call_id`` is the caller's call that started it. On a fork (US-54.5),
    ``reused`` marks a record copied from the source step rather than run again,
    and ``instructions_overridden`` one that ran with the fork's instructions.
    """

    model_config = ConfigDict(extra="forbid")
    execution_id: uuid.UUID
    parent_execution_id: uuid.UUID | None = None
    tool_call_id: str | None = None
    reused: bool = False
    instructions_overridden: bool = False
    sub_agent_id: uuid.UUID
    name: str
    model_id: uuid.UUID | None = None
    model_name: str | None = None
    provider_type: ProviderType | None = None
    pricing: ModelPricing | None = None
    steps: list[UsageStep] = Field(default_factory=list)
    # What this sub-agent could use, recorded when it started (US-54.2).
    capabilities: CapabilityManifest | None = None
    # What this sub-agent was given, recorded when it started (US-54.3).
    context: ContextManifest | None = None
    depth: int = Field(ge=0)
    status: DelegationStatus
    started_at_ms: int = Field(ge=0)
    ended_at_ms: int = Field(ge=0)
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_results: list[ToolResult] = Field(default_factory=list)
    output: str = ""
    error: str | None = None
    # References in ``output``, resolved when the parent step was saved (US-56.3).
    inline_files: list[InlineFileReference] = Field(default_factory=list)
    # Citations in ``output``, resolved against this sub-agent's own retrievals (US-55.1).
    citations: list[SpanCitation] = Field(default_factory=list)


class MessageFileReference(BaseModel):
    file_id: uuid.UUID
    filename: str
    name: str
    mime_type: str
    size: int = Field(ge=0)
    kind: FileKind
    status: FileContentStatus
    available: bool = True


class ChatModelChoice(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str | None = None
    provider_id: uuid.UUID
    provider_name: str
    provider_type: ProviderType
    available: bool
    enabled: bool = True
    authorized: bool = True
    unavailable_reason: str | None = None
    # Stable code for plan recovery UI, e.g. ``chatgpt_plan_usage_limit``.
    unavailable_code: str | None = None
    context_window: int | None = None
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN
    supports_vision: bool | None = None
    supports_tools: bool | None = None
    # Price metadata snapshotted with the choice; executions keep it (US-54.1).
    pricing: ModelPricing | None = None


class SkillSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0, le=2_147_483_647)
    skill_ids: list[uuid.UUID] = Field(max_length=8)
    refresh_ids: list[uuid.UUID] = Field(default_factory=list, max_length=8)


class ActiveSkill(SkillIdentity):
    available: bool = True
    update_available: bool = False


class ActiveSkillState(BaseModel):
    revision: int = Field(default=0, ge=0)
    skills: list[ActiveSkill] = Field(default_factory=list)


class ForkProvenance(BaseModel):
    """Where a forked run came from and what it changed (US-54.5, ADR-0038).

    ``step_index`` is the zero-based step the fork replays; ``overrides`` lists
    every sub-agent whose instructions differ, as digests only.
    """

    model_config = ConfigDict(extra="forbid")
    source_message_id: uuid.UUID
    source_execution_id: uuid.UUID
    delegation_execution_id: uuid.UUID
    sub_agent_id: uuid.UUID
    step_index: int = Field(ge=0)
    overrides: list[InstructionOverrideProvenance] = Field(default_factory=list)


class MessageExecution(BaseModel):
    skills: list[SkillIdentity] = Field(default_factory=list)
    persona: PersonaProvenance
    learning_mode: LearningModeProvenance
    context: ContextProvenance | None = None
    # What the main agent could use in this run, recorded at acceptance (US-54.2).
    capabilities: CapabilityManifest | None = None
    prompt: PromptProvenance = Field(default_factory=PromptProvenance)
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    request_message_id: uuid.UUID
    model: ChatModelChoice
    model_revision: int = Field(ge=1)
    configuration: MainAgentConfiguration
    # Set when this run is a fork of a recorded run (US-54.5).
    fork: ForkProvenance | None = None


class ChatModelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
    expected_model_revision: int = Field(ge=1)


class NewMessageRequest(BaseModel):
    execution: MessageExecution | None = None
    model_id: uuid.UUID
    role: str
    content: str
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    generation_duration_ms: int = Field(default=0)
    thinking: str = Field(default="")
    parent_message_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus = Field(default=MessageStatus.PENDING)
    tool_calls: list[ToolCall] | None = Field(default=None)
    tool_call_results: list[ToolResult] | None = Field(default=None)
    delegations: list[DelegationRecord] | None = Field(default=None)
    context: ContextManifest | None = None
    files: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class Message(LLMMessage):
    skills: list[SkillIdentity] = Field(default_factory=list)
    learning_mode: LearningModeProvenance | None = None
    template: TemplateLabel | None = None
    execution: MessageExecution | None = None
    model_config = ConfigDict(from_attributes=True)
    # Persisted chat content remains plain text; multimodal parts are runtime-only.
    content: str  # type: ignore[reportIncompatibleVariableOverride] - persisted messages are text only
    id: uuid.UUID
    status: MessageStatus
    created_at: int
    model_id: uuid.UUID | None = None
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)
    generation_duration_ms: int = Field(default=0)
    tool_call_results: list[ToolResult] | None = None
    delegations: list[DelegationRecord] | None = None
    # What the model was given for this step, recorded when it ran (US-54.3).
    context: ContextManifest | None = None
    files: list[MessageFileReference] = Field(default_factory=list)
    # References in ``content``, resolved at save time (US-56.3, ADR-0039).
    inline_files: list[InlineFileReference] = Field(default_factory=list)
    # Claim citations in ``content``, resolved at save time (US-55.1, ADR-0040).
    citations: list[SpanCitation] = Field(default_factory=list)
    # The latest verify pass of this answer (US-55.2); labels, not edits.
    verification: MessageVerification | None = None
    # The latest disagreement pass anchored here (US-55.3): on a comparison's
    # first column turn, or on a step whose sub-agents were compared.
    disagreements: DisagreementSummary | None = None
    # Set on spot-the-error answers (US-55.4): always labelled as an exercise.
    exercise: ExerciseView | None = None
    active_child_id: uuid.UUID | None = None
    has_siblings: bool = False
    sibling_count: int = 0
    current_sibling_index: int = -1
    parent_message_id: uuid.UUID | None = None
    next_sibling_id: uuid.UUID | None = None
    previous_sibling_id: uuid.UUID | None = None
    # US-54.4: set on user turns that are columns of a comparison.
    comparison_id: uuid.UUID | None = None
    comparison_index: int | None = None
    target_model_id: uuid.UUID | None = None
    comparison_label: str | None = None


class MessageList(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    messages: list[Message]


class MessageForkRequest(BaseModel):
    """Fork a recorded run at one delegation with run-only sub-agent instructions."""

    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    delegation_execution_id: uuid.UUID
    instructions: str = Field(max_length=MAX_OVERRIDE_CHARS)


class ForkInstructions(BaseModel):
    """Starting point for the fork dialog; owner only.

    ``source`` says whether the text is the run's own fork override or the
    definition's current instructions. ``rerun_execution_id`` is the top-level
    delegation that runs again (itself, unless the node is nested).
    """

    sub_agent_id: uuid.UUID
    sub_agent_name: str
    instructions: str
    source: Literal["fork", "definition"]
    definition_revision: int = Field(ge=1)
    rerun_execution_id: uuid.UUID
    rerun_sub_agent_name: str


class RecordedRun(BaseModel):
    """One recorded run on any branch, for run diff (US-54.6).

    ``request`` is the user turn the run answers; ``steps`` are its assistant
    steps along that branch, in order. Everything is as recorded at execution.
    """

    request: Message
    steps: list[Message]


class UpdateMessageRequest(BaseModel):
    content: str | None = Field(default=None)
    thinking: str | None = Field(default=None)
    active_child_id: uuid.UUID | None = Field(default=None)
    status: MessageStatus | None = Field(default=None)
    tool_results: list[ToolResult] | None = Field(default=None)
    tool_call_results: list[ToolResult] | None = Field(default=None)


class ChatContextModel(BaseModel):
    id: uuid.UUID
    name: str
    context_window: int | None = None
    context_window_source: ModelCapabilitySource = ModelCapabilitySource.UNKNOWN


class ChatContextUsage(BaseModel):
    input_tokens: int = Field(ge=0)
    reserved_output_tokens: int | None = Field(default=None, ge=0)
    total_tokens: int = Field(ge=0)
    estimated: bool = True


class ChatInfo(BaseModel):
    active_skills: ActiveSkillState = Field(default_factory=ActiveSkillState)
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    user_id: str
    created_at: int
    updated_at: int
    allowed_tools: list[str] = Field(default_factory=list)
    title: str | None = Field(default=None)
    project_id: uuid.UUID | None = Field(default=None)
    agent_id: uuid.UUID | None = Field(default=None)
    preview: str | None = Field(default=None)
    message_count: int | None = Field(default=None)
    context_model: ChatContextModel | None = Field(default=None)
    persona_id: uuid.UUID | None = None
    persona_revision: int = Field(default=1, ge=1)
    learning_mode: LearningModeId = LearningModeId.STANDARD
    learning_mode_revision: int = Field(default=1, ge=1)
    # Self-imposed lock (US-52.5); never set while the mode is Standard.
    learning_mode_locked: bool = False
    # The active branch's hint level, carried by its latest user turn.
    hint_level: HintLevel = HintLevel.NONE
    selected_model_id: uuid.UUID | None = None
    model_revision: int = Field(default=1, ge=1)
    selected_model: ChatModelChoice | None = None
    pending_execution: MessageExecution | None = None
    pending_persona: PersonaProvenance | None = None
    pending_learning_mode: LearningModeProvenance | None = None
    resume_error: str | None = None


class ChatInfoList(BaseModel):
    chats: list[ChatInfo]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class SearchResultKind(StrEnum):
    CHAT = auto()
    PROJECT = auto()


class SearchMatchSource(StrEnum):
    TITLE = auto()
    CONTENT = auto()
    PROJECT_NAME = auto()
    PROJECT_DESCRIPTION = auto()


class SearchResult(BaseModel):
    kind: SearchResultKind
    id: uuid.UUID
    title: str
    updated_at: int
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    match_source: SearchMatchSource
    snippet: str | None = None


class SearchResultList(BaseModel):
    results: list[SearchResult]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class Chat(BaseModel):
    info: ChatInfo
    messages: list[Message]
    context_usage: ChatContextUsage | None = None


class BulkDeleteChatRequest(BaseModel):
    chat_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class BulkDeleteChatResponse(BaseModel):
    deleted_chat_ids: list[uuid.UUID]


MIN_COMPARISON_COLUMNS = 2
MAX_COMPARISON_COLUMNS = 3


class ComparisonTarget(BaseModel):
    """One comparison column: a fixed model and, optionally, its own prompt.

    Without ``user_prompt`` the column uses the request's prompt. Columns must
    differ in model or prompt.
    """

    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID
    user_prompt: str | None = Field(default=None, max_length=100_000)
    # Optional column heading, e.g. "Before" and "After" for a prompt rewrite.
    label: str | None = Field(default=None, min_length=1, max_length=40)


ComparisonTargets = Annotated[
    list[ComparisonTarget],
    Field(min_length=MIN_COMPARISON_COLUMNS, max_length=MAX_COMPARISON_COLUMNS),
]


class HintRequest(BaseModel):
    """Raise the branch hint level with this turn, or reset it with ``none``.

    Raising must go up from the branch's current level (or from ``none`` with
    ``reset``) and must be offered by the chat's learning mode. Revealing the
    answer needs ``confirm_reveal``; while the chat's learning mode is locked
    it also needs ``override_lock``.
    """

    model_config = ConfigDict(extra="forbid")
    level: HintLevel
    reset: bool = False
    confirm_reveal: bool = False
    override_lock: bool = False


class NewChatRequest(BaseModel):
    # US-54.4: run the prompt as sibling comparison columns instead of one turn.
    compare: ComparisonTargets | None = None
    skills: SkillSelection | None = None
    template: TemplateUse | None = None
    persona_id: uuid.UUID | None = None
    learning_mode: LearningModeId = LearningModeId.STANDARD
    hint: HintRequest | None = None
    model_id: uuid.UUID
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    draft_id: uuid.UUID | None = None
    user_prompt: str
    project_id: uuid.UUID | None = Field(default=None)
    files: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class ChatUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None)


class ChatMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: uuid.UUID | None


class ScopedChatFile(BaseModel):
    file_id: uuid.UUID
    sources: list[Literal["project", "chat"]]
    message_ids: list[uuid.UUID] = Field(default_factory=list)


class ChatFileScope(BaseModel):
    chat_id: uuid.UUID
    project_id: uuid.UUID | None
    project_context_revision: int | None = None
    project_system_prompt: str = ""
    allowed_file_ids: list[uuid.UUID]
    files: list[ScopedChatFile]
    unavailable_file_ids: list[uuid.UUID]


class ChatDraftCreate(BaseModel):
    model_id: uuid.UUID | None = None
    model_config = ConfigDict(extra="forbid")
    chat_id: uuid.UUID | None = None


class ChatDraftFiles(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_ids: list[uuid.UUID] = Field(max_length=100)


class ChatDraft(BaseModel):
    model_id: uuid.UUID | None = None
    id: uuid.UUID
    chat_id: uuid.UUID | None
    expires_at: int
    file_ids: list[uuid.UUID]
    unavailable_file_ids: list[uuid.UUID]


class ChatSendRequest(BaseModel):
    compare: ComparisonTargets | None = None
    skills: SkillSelection | None = None
    template: TemplateUse | None = None
    hint: HintRequest | None = None
    expected_model_revision: int = Field(ge=1)
    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    user_prompt: str
    parent_message_id: uuid.UUID | None
    draft_id: uuid.UUID | None = None
    files: list[uuid.UUID] = Field(default_factory=list, max_length=100)


class ChatDraftModelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: uuid.UUID | None
    expected_model_id: uuid.UUID | None


class ChatPersonaUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona_id: uuid.UUID | None
    expected_persona_revision: int = Field(ge=1)


class ChatLearningModeUpdate(BaseModel):
    """Select the chat's learning mode and optionally lock or unlock it.

    ``locked`` omitted keeps the current lock. Standard cannot be locked, so
    selecting it releases the lock. Releasing a lock, explicitly or by
    selecting Standard, needs ``override_lock``.
    """

    model_config = ConfigDict(extra="forbid")
    learning_mode: LearningModeId
    expected_learning_mode_revision: int = Field(ge=1)
    locked: bool | None = None
    override_lock: bool = False


class MessageCompareRequest(BaseModel):
    """Compare an answered turn with one or two more targets (US-54.4).

    The existing turn becomes column 0; each target adds a column that reruns
    the same accepted inputs (prompt, files, skills, persona, learning mode,
    template).
    """

    model_config = ConfigDict(extra="forbid")
    request_id: uuid.UUID
    targets: list[ComparisonTarget] = Field(min_length=1, max_length=MAX_COMPARISON_COLUMNS - 1)


ComparisonColumnStatus = Literal["pending", "completed", "cancelled"]


class ComparisonColumn(BaseModel):
    """One column: its user turn, the assistant steps that answered it, and usage totals."""

    index: int
    request: Message
    replies: list[Message] = Field(default_factory=list)
    # Current listing of the fixed target model; None when it was removed.
    model: ChatModelChoice | None = None
    status: ComparisonColumnStatus
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    generation_duration_ms: int = 0


class ChatComparison(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    parent_message_id: uuid.UUID | None
    # The column the conversation continues from, if it is on the active branch.
    active_index: int | None
    columns: list[ComparisonColumn]


class ComparisonActivate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(ge=0, le=MAX_COMPARISON_COLUMNS - 1)


class ContextLayerText(BaseModel):
    """One recorded prompt layer with its text; returned only to the chat owner."""

    kind: LayerKind
    source_id: str
    revision: int
    text: str


class ContextLayerTexts(BaseModel):
    layers: list[ContextLayerText]
