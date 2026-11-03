"""Message provenance for prompts built from a template or bundled framework.

Provenance is a label only: it records which template shaped a prompt, never
grants capabilities, and does not change how the message executes.
"""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException

from .catalog import FRAMEWORKS
from .models import PromptTemplateModel
from .queries import select_owned_templates

ScaffoldingLevel = Literal["guided", "standard", "freeform"]
TemplateSource = Literal["framework", "template"]


class TemplateUse(BaseModel):
    """Client claim attached to a send: which template built this prompt."""

    model_config = ConfigDict(extra="forbid")
    source: TemplateSource
    id: str = Field(min_length=1, max_length=64)
    revision: int = Field(ge=1, le=2_147_483_647)
    level: ScaffoldingLevel


class TemplateProvenance(BaseModel):
    """Server-resolved snapshot stored immutably on the accepted user message."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    source: TemplateSource
    id: str
    revision: int
    level: ScaffoldingLevel
    name: str


class TemplateLabel(TemplateProvenance):
    """Provenance plus live availability, computed when history is read."""

    model_config = ConfigDict(extra="forbid", frozen=False)
    available: bool = True


def _check_revision(claimed: int, current: int) -> None:
    # Edits elsewhere may advance the template after the prompt was built; a
    # revision from the future cannot be genuine.
    if claimed > current:
        raise BadDataException("Template revision is newer than the current template")


async def resolve_template_use(*, user_id: str, use: TemplateUse, session: AsyncSession) -> TemplateProvenance:
    """Validate a send's template claim against the catalog or the owner's templates."""
    if use.source == "framework":
        framework = FRAMEWORKS.get(use.id)
        if framework is None:
            raise NotFoundException("Prompt framework not found")
        _check_revision(use.revision, framework.revision)
        name = framework.document.name
    else:
        try:
            template_id = uuid.UUID(use.id)
        except ValueError as exc:
            raise NotFoundException("Prompt template not found") from exc
        row = await session.scalar(select_owned_templates(user_id).where(PromptTemplateModel.id == template_id))
        if row is None:
            raise NotFoundException("Prompt template not found")
        _check_revision(use.revision, row.revision)
        return TemplateProvenance(
            source="template", id=str(row.id), revision=use.revision, level=use.level, name=row.name
        )
    return TemplateProvenance(source=use.source, id=use.id, revision=use.revision, level=use.level, name=name)


async def label_availability(*, user_id: str, labels: list[TemplateLabel], session: AsyncSession) -> None:
    """Mark labels whose template or framework no longer exists as unavailable."""
    owned = {uuid.UUID(label.id) for label in labels if label.source == "template"}
    existing: set[str] = set()
    if owned:
        rows = await session.scalars(
            select_owned_templates(user_id)
            .where(PromptTemplateModel.id.in_(owned))
            .with_only_columns(PromptTemplateModel.id)
        )
        existing = {str(row) for row in rows}
    for label in labels:
        label.available = label.id in FRAMEWORKS if label.source == "framework" else label.id in existing
