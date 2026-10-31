"""Authenticated private template CRUD and the read-only bundled framework catalog."""

import uuid

from fastapi import APIRouter, Path, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import service
from .schemas import (
    MAX_REVISION,
    PromptFramework,
    PromptFrameworkCatalog,
    PromptTemplate,
    PromptTemplateCreate,
    PromptTemplatePage,
    PromptTemplateUpdate,
)

prompt_templates_router = APIRouter(
    prefix="/prompt-templates",
    tags=["prompt-templates"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)


# Static catalog routes must precede /{template_id}. The catalog has no write routes.
@prompt_templates_router.get("/frameworks", operation_id="promptFrameworkGetMany")
async def list_frameworks(user: AuthedUserDep) -> PromptFrameworkCatalog:
    return service.list_frameworks()


@prompt_templates_router.get("/frameworks/{framework_id}", operation_id="promptFrameworkGetOne")
async def get_framework(user: AuthedUserDep, framework_id: str = Path(max_length=64)) -> PromptFramework:
    return service.read_framework(framework_id)


@prompt_templates_router.get("/", operation_id="promptTemplateGetMany")
async def list_templates(
    user: AuthedUserDep,
    session: DBSessionDep,
    query: str = Query(default="", max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> PromptTemplatePage:
    return await service.list_templates(user.id, session, query=query, page=page, page_size=page_size)


@prompt_templates_router.post("/", operation_id="promptTemplateCreate", status_code=201)
async def create(payload: PromptTemplateCreate, user: AuthedUserDep, session: DBSessionDep) -> PromptTemplate:
    return await service.create_template(user.id, payload, session)


@prompt_templates_router.get("/{template_id}", operation_id="promptTemplateGetOne")
async def get_one(template_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> PromptTemplate:
    return await service.read_template(user.id, template_id, session)


@prompt_templates_router.put("/{template_id}", operation_id="promptTemplateUpdate")
async def update(
    template_id: uuid.UUID, payload: PromptTemplateUpdate, user: AuthedUserDep, session: DBSessionDep
) -> PromptTemplate:
    return await service.update_template(user.id, template_id, payload, session)


@prompt_templates_router.delete("/{template_id}", operation_id="promptTemplateDelete", status_code=204)
async def delete(
    template_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
    expected_revision: int = Query(ge=1, le=MAX_REVISION),
) -> Response:
    await service.delete_template(user.id, template_id, expected_revision, session)
    return Response(status_code=204)
