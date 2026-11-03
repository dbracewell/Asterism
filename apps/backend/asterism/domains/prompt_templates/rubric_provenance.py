"""Rubrics attached to Draft feedback turns (US-57.1).

A send names a bundled or owned rubric; the server pins a snapshot of its
current document on the accepted user message, so execution, resume and
regeneration assess against exactly the rubric the learner chose. The rubric
is assessment text only and grants nothing.
"""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException

from .models import PromptTemplateModel
from .queries import select_owned_rubrics
from .rubric_catalog import RUBRICS
from .rubrics import RubricDocument, parse_rubric_json

RubricSource = Literal["bundled", "owned"]


class RubricUse(BaseModel):
    """Client claim attached to a send: which rubric to assess the draft against."""

    model_config = ConfigDict(extra="forbid")
    source: RubricSource
    id: str = Field(min_length=1, max_length=64)


class RubricProvenance(BaseModel):
    """Public identity of a turn's rubric, with the labels a reply is parsed against."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    source: RubricSource
    id: str
    revision: int = Field(ge=1)
    name: str
    # Level names from highest to lowest, and criterion names in rubric order.
    levels: tuple[str, ...]
    criteria: tuple[str, ...]


class RubricSnapshot(BaseModel):
    """Server-resolved rubric stored immutably on the accepted user message."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    source: RubricSource
    id: str
    revision: int = Field(ge=1)
    document: RubricDocument

    @property
    def provenance(self) -> RubricProvenance:
        return RubricProvenance(
            source=self.source,
            id=self.id,
            revision=self.revision,
            name=self.document.name,
            levels=self.document.levels,
            criteria=tuple(criterion.label for criterion in self.document.criteria),
        )


class RubricLabel(RubricSnapshot):
    """The pinned rubric plus live availability, computed when history is read."""

    model_config = ConfigDict(extra="forbid", frozen=False)
    available: bool = True


async def resolve_rubric_use(*, user_id: str, use: RubricUse, session: AsyncSession) -> RubricSnapshot:
    """Snapshot the current document of a bundled rubric or one the caller owns."""
    if use.source == "bundled":
        bundled = RUBRICS.get(use.id)
        if bundled is None:
            raise NotFoundException("Rubric not found")
        return RubricSnapshot(source="bundled", id=bundled.id, revision=bundled.revision, document=bundled.document)
    try:
        rubric_id = uuid.UUID(use.id)
    except ValueError as exc:
        raise NotFoundException("Rubric not found") from exc
    row = await session.scalar(select_owned_rubrics(user_id).where(PromptTemplateModel.id == rubric_id))
    if row is None:
        raise NotFoundException("Rubric not found")
    return RubricSnapshot(
        source="owned", id=str(row.id), revision=row.revision, document=parse_rubric_json(row.document)
    )


async def rubric_availability(*, user_id: str, labels: list[RubricLabel], session: AsyncSession) -> None:
    """Mark labels whose rubric was deleted or retired as unavailable; history stays readable."""
    owned = {uuid.UUID(label.id) for label in labels if label.source == "owned"}
    existing: set[str] = set()
    if owned:
        rows = await session.scalars(
            select_owned_rubrics(user_id)
            .where(PromptTemplateModel.id.in_(owned))
            .with_only_columns(PromptTemplateModel.id)
        )
        existing = {str(row) for row in rows}
    for label in labels:
        label.available = label.id in RUBRICS if label.source == "bundled" else label.id in existing
