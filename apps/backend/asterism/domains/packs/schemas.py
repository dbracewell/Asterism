"""Wire schemas for exporting, reviewing and importing team packs."""

import uuid
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool

from asterism.domains.agent.schemas import GenerationDefaults
from asterism.domains.projects.schemas import ProjectName
from asterism.domains.prompt_templates.documents import TemplateDocument
from asterism.domains.prompt_templates.rubrics import RubricDocument

from .documents import (
    MAX_AGENT_NAME_LENGTH,
    MAX_PACK_BYTES,
    MAX_PACK_DESCRIPTION_LENGTH,
    MAX_PACK_NAME_LENGTH,
    MAX_REQUESTED_TOOLS,
    MAX_RUBRICS,
    MAX_SKILLS,
    MAX_SUB_AGENTS,
    MAX_TEMPLATES,
    PACK_VERSION_PATTERN,
    ModelRequirements,
    PackIdentity,
    PackProject,
    one_line,
)


class PackExportRequest(BaseModel):
    """What to include. Nothing is exported unless it is named here."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=MAX_PACK_NAME_LENGTH)
    description: str = Field(default="", max_length=MAX_PACK_DESCRIPTION_LENGTH)
    version: str = Field(default="1.0.0", pattern=PACK_VERSION_PATTERN)
    sub_agent_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_SUB_AGENTS)
    skill_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_SKILLS)
    template_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_TEMPLATES)
    rubric_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_RUBRICS)
    include_project_settings: StrictBool = False


class PackSource(BaseModel):
    """The pack file's text. Review and import both parse it from scratch."""

    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1, max_length=MAX_PACK_BYTES)


class PackModelOption(BaseModel):
    """A model the user may bind, with the stated requirements it does not meet."""

    id: uuid.UUID
    name: str
    provider_name: str
    unmet_requirements: list[Literal["tools", "vision", "context_window"]]


class PackToolRequest(BaseModel):
    """A requested tool; ``available`` is false when admin policy here rules it out."""

    name: str
    available: bool


class PackSubAgentReview(BaseModel):
    key: str
    name: str
    description: str
    instructions: str
    max_steps: int
    generation: GenerationDefaults
    requested_tools: list[PackToolRequest]
    # Keys of pack skills this sub-agent asks to load; assigned only when approved.
    requested_skills: list[str] = Field(default_factory=list)
    model_requirements: ModelRequirements
    model_options: list[PackModelOption]
    name_conflict: bool


class PackSkillReview(BaseModel):
    key: str
    name: str
    description: str
    content: str
    assignment_requested: bool
    assignment_allowed: bool
    name_conflict: bool


class PackTemplateReview(BaseModel):
    key: str
    name: str
    document: TemplateDocument
    name_conflict: bool


class PackRubricReview(BaseModel):
    key: str
    name: str
    document: RubricDocument
    name_conflict: bool


class PackProjectReview(PackProject):
    name_conflict: bool


class PackReview(BaseModel):
    """Everything the pack asks for. Producing this changes nothing."""

    pack: PackIdentity
    sub_agents: list[PackSubAgentReview]
    skills: list[PackSkillReview]
    templates: list[PackTemplateReview]
    rubrics: list[PackRubricReview]
    project: PackProjectReview | None


ItemName = Annotated[str, AfterValidator(one_line), Field(min_length=1, max_length=MAX_AGENT_NAME_LENGTH)]


class PackItemDecision(BaseModel):
    """The user's choice for one item. ``name`` replaces the pack's name."""

    model_config = ConfigDict(extra="forbid")

    key: str
    include: StrictBool
    name: ItemName | None = None


class PackSubAgentDecision(PackItemDecision):
    model_id: uuid.UUID | None = None
    approved_tools: list[str] = Field(default_factory=list, max_length=MAX_REQUESTED_TOOLS)
    # Keys of requested pack skills to assign to this sub-agent; each must be imported too.
    approved_skills: list[str] = Field(default_factory=list, max_length=MAX_SKILLS)


class PackSkillDecision(PackItemDecision):
    assign_to_main_agent: StrictBool = False


class PackProjectDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include: StrictBool
    name: ProjectName | None = None


class PackImportRequest(PackSource):
    """A decision for every item in the pack. Nothing is implied by omission."""

    sub_agents: list[PackSubAgentDecision] = Field(default_factory=list, max_length=MAX_SUB_AGENTS)
    skills: list[PackSkillDecision] = Field(default_factory=list, max_length=MAX_SKILLS)
    templates: list[PackItemDecision] = Field(default_factory=list, max_length=MAX_TEMPLATES)
    rubrics: list[PackItemDecision] = Field(default_factory=list, max_length=MAX_RUBRICS)
    project: PackProjectDecision | None = None


class PackImportResult(BaseModel):
    import_id: uuid.UUID
    sub_agent_ids: list[uuid.UUID]
    skill_ids: list[uuid.UUID]
    template_ids: list[uuid.UUID]
    rubric_ids: list[uuid.UUID]
    project_id: uuid.UUID | None


class StarterPack(BaseModel):
    """A bundled pack. ``source`` goes through the normal review and import."""

    id: str
    version: str
    name: str
    description: str
    source: str


class StarterPackCatalog(BaseModel):
    items: list[StarterPack]
