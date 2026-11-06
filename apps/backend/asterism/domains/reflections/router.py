"""Authenticated, owner-only reflection records and draft suggestions (US-58.2)."""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import service
from .draft import suggest_draft
from .schemas import (
    MAX_REVISION,
    Reflection,
    ReflectionCreate,
    ReflectionDraft,
    ReflectionDraftRequest,
    ReflectionPage,
    ReflectionUpdate,
)

reflections_router = APIRouter(
    prefix="/reflections",
    tags=["reflections"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)


@reflections_router.post(
    "/draft",
    operation_id="reflectionDraftCreate",
    responses={502: {"model": ErrorDetail}, 503: {"model": ErrorDetail}},
)
async def draft(
    payload: ReflectionDraftRequest, user: AuthedUserDep, db: DBSessionDep, response: Response
) -> ReflectionDraft:
    """Suggest a reflection from one owned chat; nothing is stored."""
    response.headers["Cache-Control"] = "no-store"
    return await suggest_draft(user_id=user.id, chat_id=payload.chat_id, session=db)


@reflections_router.get("/", operation_id="reflectionGetMany")
async def list_reflections(
    user: AuthedUserDep,
    db: DBSessionDep,
    project_id: uuid.UUID | None = None,
    persona_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
) -> ReflectionPage:
    """One project's reflections (General without ``project_id``), optionally one persona's."""
    return await service.list_reflections(
        user.id, db, project_id=project_id, persona_id=persona_id, page=page, page_size=page_size
    )


@reflections_router.post("/", operation_id="reflectionCreate", status_code=201)
async def create(payload: ReflectionCreate, user: AuthedUserDep, db: DBSessionDep) -> Reflection:
    return await service.create_reflection(user.id, payload, db)


@reflections_router.put("/{reflection_id}", operation_id="reflectionUpdate")
async def update(
    reflection_id: uuid.UUID, payload: ReflectionUpdate, user: AuthedUserDep, db: DBSessionDep
) -> Reflection:
    return await service.update_reflection(user.id, reflection_id, payload, db)


@reflections_router.delete("/{reflection_id}", operation_id="reflectionDelete", status_code=204)
async def delete(
    reflection_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    expected_revision: int = Query(ge=1, le=MAX_REVISION),
) -> Response:
    await service.delete_reflection(user.id, reflection_id, expected_revision, db)
    return Response(status_code=204)
