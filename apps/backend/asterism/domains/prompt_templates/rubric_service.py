"""Owned rubric lifecycle, paginated reads and the read-only bundled catalog (US-57.1)."""

import uuid

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.db.queries import paginate_select

from .models import PromptTemplateModel, TemplateKind
from .queries import search_owned_rubrics, select_owned_rubrics
from .rubric_catalog import RUBRIC_CATALOG_VERSION, RUBRICS, BundledRubric
from .rubric_schemas import (
    BundledRubricView,
    Rubric,
    RubricCatalog,
    RubricCreate,
    RubricPage,
    RubricSummary,
    RubricUpdate,
)
from .rubrics import RubricDocument, parse_rubric, parse_rubric_json, serialize_rubric

logger = get_logger("Rubrics")


def _to_rubric(row: PromptTemplateModel) -> Rubric:
    return Rubric(
        id=row.id,
        name=row.name,
        description=row.description,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        document=parse_rubric_json(row.document),
    )


def _columns(document: RubricDocument) -> dict[str, str]:
    return {"document": serialize_rubric(document), "name": document.name, "description": document.description}


async def require_rubric(user_id: str, rubric_id: uuid.UUID, session: AsyncSession) -> PromptTemplateModel:
    row = await session.scalar(select_owned_rubrics(user_id).where(PromptTemplateModel.id == rubric_id))
    if row is None:
        raise NotFoundException("Rubric not found")
    return row


async def read_rubric(user_id: str, rubric_id: uuid.UUID, session: AsyncSession) -> Rubric:
    return _to_rubric(await require_rubric(user_id, rubric_id, session))


async def list_rubrics(user_id: str, session: AsyncSession, *, query: str, page: int, page_size: int) -> RubricPage:
    result = await paginate_select(
        statement=search_owned_rubrics(user_id, query).options(defer(PromptTemplateModel.document)),
        session=session,
        page=page,
        page_size=page_size,
    )
    return RubricPage(
        items=[RubricSummary.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def create_rubric(user_id: str, payload: RubricCreate, session: AsyncSession) -> Rubric:
    document = parse_rubric(payload.document)
    row = PromptTemplateModel(user_id=user_id, kind=TemplateKind.RUBRIC, **_columns(document))
    session.add(row)
    await session.commit()
    await session.refresh(row)
    logger.info(f"Created rubric {row.id} for user {user_id}")
    return _to_rubric(row)


async def update_rubric(user_id: str, rubric_id: uuid.UUID, payload: RubricUpdate, session: AsyncSession) -> Rubric:
    await require_rubric(user_id, rubric_id, session)
    document = parse_rubric(payload.document)
    result = await session.execute(
        update(PromptTemplateModel)
        .where(
            PromptTemplateModel.id == rubric_id,
            PromptTemplateModel.user_id == user_id,
            PromptTemplateModel.kind == TemplateKind.RUBRIC,
            PromptTemplateModel.revision == payload.expected_revision,
        )
        .values(**_columns(document), revision=PromptTemplateModel.revision + 1)
        .returning(PromptTemplateModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Rubric changed; reload before saving")
    await session.commit()
    logger.info(f"Updated rubric {rubric_id} for user {user_id}")
    return await read_rubric(user_id, rubric_id, session)


async def delete_rubric(user_id: str, rubric_id: uuid.UUID, expected_revision: int, session: AsyncSession) -> None:
    await require_rubric(user_id, rubric_id, session)
    result = await session.execute(
        delete(PromptTemplateModel)
        .where(
            PromptTemplateModel.id == rubric_id,
            PromptTemplateModel.user_id == user_id,
            PromptTemplateModel.kind == TemplateKind.RUBRIC,
            PromptTemplateModel.revision == expected_revision,
        )
        .returning(PromptTemplateModel.id)
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Rubric changed; reload before deleting")
    await session.commit()
    logger.info(f"Deleted rubric {rubric_id} for user {user_id}")


def _to_bundled(rubric: BundledRubric) -> BundledRubricView:
    return BundledRubricView(
        id=rubric.id,
        revision=rubric.revision,
        name=rubric.document.name,
        description=rubric.document.description,
        document=rubric.document,
    )


def list_bundled_rubrics() -> RubricCatalog:
    return RubricCatalog(version=RUBRIC_CATALOG_VERSION, items=[_to_bundled(item) for item in RUBRICS.values()])


def read_bundled_rubric(rubric_id: str) -> BundledRubricView:
    rubric = RUBRICS.get(rubric_id)
    if rubric is None:
        raise NotFoundException("Rubric not found")
    return _to_bundled(rubric)
