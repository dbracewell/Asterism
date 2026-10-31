"""Template document lifecycle, paginated reads, and the read-only framework catalog."""

import uuid

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.db.queries import paginate_select

from .catalog import CATALOG_VERSION, FRAMEWORKS, BundledFramework
from .documents import TemplateDocument, parse_document, parse_document_json, serialize_document
from .models import PromptTemplateModel
from .queries import search_owned_templates, select_owned_templates
from .schemas import (
    PromptFramework,
    PromptFrameworkCatalog,
    PromptTemplate,
    PromptTemplateCreate,
    PromptTemplatePage,
    PromptTemplateSummary,
    PromptTemplateUpdate,
)

logger = get_logger("PromptTemplates")


def _to_template(row: PromptTemplateModel) -> PromptTemplate:
    return PromptTemplate(
        id=row.id,
        name=row.name,
        description=row.description,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        document=parse_document_json(row.document),
    )


def _columns(document: TemplateDocument) -> dict[str, str]:
    return {"document": serialize_document(document), "name": document.name, "description": document.description}


async def require_template(user_id: str, template_id: uuid.UUID, session: AsyncSession) -> PromptTemplateModel:
    row = await session.scalar(select_owned_templates(user_id).where(PromptTemplateModel.id == template_id))
    if row is None:
        raise NotFoundException("Prompt template not found")
    return row


async def read_template(user_id: str, template_id: uuid.UUID, session: AsyncSession) -> PromptTemplate:
    return _to_template(await require_template(user_id, template_id, session))


async def list_templates(
    user_id: str, session: AsyncSession, *, query: str, page: int, page_size: int
) -> PromptTemplatePage:
    result = await paginate_select(
        statement=search_owned_templates(user_id, query).options(defer(PromptTemplateModel.document)),
        session=session,
        page=page,
        page_size=page_size,
    )
    return PromptTemplatePage(
        items=[PromptTemplateSummary.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def create_template(user_id: str, payload: PromptTemplateCreate, session: AsyncSession) -> PromptTemplate:
    document = parse_document(payload.document)
    row = PromptTemplateModel(user_id=user_id, **_columns(document))
    session.add(row)
    await session.commit()
    await session.refresh(row)
    logger.info(f"Created prompt template {row.id} for user {user_id}")
    return _to_template(row)


async def update_template(
    user_id: str, template_id: uuid.UUID, payload: PromptTemplateUpdate, session: AsyncSession
) -> PromptTemplate:
    await require_template(user_id, template_id, session)
    document = parse_document(payload.document)
    result = await session.execute(
        update(PromptTemplateModel)
        .where(
            PromptTemplateModel.id == template_id,
            PromptTemplateModel.user_id == user_id,
            PromptTemplateModel.revision == payload.expected_revision,
        )
        .values(**_columns(document), revision=PromptTemplateModel.revision + 1)
        .returning(PromptTemplateModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Prompt template changed; reload before saving")
    await session.commit()
    logger.info(f"Updated prompt template {template_id} for user {user_id}")
    return await read_template(user_id, template_id, session)


async def delete_template(user_id: str, template_id: uuid.UUID, expected_revision: int, session: AsyncSession) -> None:
    await require_template(user_id, template_id, session)
    result = await session.execute(
        delete(PromptTemplateModel)
        .where(
            PromptTemplateModel.id == template_id,
            PromptTemplateModel.user_id == user_id,
            PromptTemplateModel.revision == expected_revision,
        )
        .returning(PromptTemplateModel.id)
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Prompt template changed; reload before deleting")
    await session.commit()
    logger.info(f"Deleted prompt template {template_id} for user {user_id}")


def _to_framework(framework: BundledFramework) -> PromptFramework:
    return PromptFramework(
        id=framework.id,
        revision=framework.revision,
        name=framework.document.name,
        description=framework.document.description,
        document=framework.document,
    )


def list_frameworks() -> PromptFrameworkCatalog:
    return PromptFrameworkCatalog(
        version=CATALOG_VERSION, items=[_to_framework(framework) for framework in FRAMEWORKS.values()]
    )


def read_framework(framework_id: str) -> PromptFramework:
    framework = FRAMEWORKS.get(framework_id)
    if framework is None:
        raise NotFoundException("Prompt framework not found")
    return _to_framework(framework)
