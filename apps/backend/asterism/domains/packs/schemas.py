"""Wire schemas for exporting a team pack; the response is the manifest itself."""

import uuid

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .documents import (
    MAX_PACK_DESCRIPTION_LENGTH,
    MAX_PACK_NAME_LENGTH,
    MAX_RUBRICS,
    MAX_SKILLS,
    MAX_SUB_AGENTS,
    MAX_TEMPLATES,
    PACK_VERSION_PATTERN,
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
