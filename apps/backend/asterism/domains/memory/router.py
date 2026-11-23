"""The signed-in person's own memories (ADR-0078). There is no route to anyone else's."""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import service
from .models import MemoryKind
from .schemas import MAX_REVISION, Memory, MemoryCreate, MemoryDeleteAll, MemoryPage, MemoryUpdate

memory_router = APIRouter(
    prefix="/users/me/memories",
    tags=["memories"],
    responses={
        400: {"model": ErrorDetail},
        401: {"model": ErrorDetail},
        404: {"model": ErrorDetail},
        409: {"model": ErrorDetail},
    },
)


@memory_router.get("/", operation_id="memoryGetMany")
async def list_memories(
    user: AuthedUserDep,
    session: DBSessionDep,
    kind: MemoryKind | None = None,
    project_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> MemoryPage:
    return await service.list_memories(
        user.id, session, kind=kind, project_id=project_id, page=page, page_size=page_size
    )


@memory_router.post("/", operation_id="memoryCreate", status_code=201)
async def create(payload: MemoryCreate, user: AuthedUserDep, session: DBSessionDep) -> Memory:
    return await service.create_memory(user.id, payload, session)


@memory_router.delete("/", operation_id="memoryDeleteAll")
async def delete_all(
    user: AuthedUserDep,
    session: DBSessionDep,
    kind: MemoryKind | None = None,
    project_id: uuid.UUID | None = None,
) -> MemoryDeleteAll:
    """Delete every memory, or every one of a kind or project."""
    deleted = await service.delete_all_memories(user.id, session, kind=kind, project_id=project_id)
    return MemoryDeleteAll(deleted=deleted)


@memory_router.get("/{memory_id}", operation_id="memoryGetOne")
async def get_one(memory_id: uuid.UUID, user: AuthedUserDep, session: DBSessionDep) -> Memory:
    return await service.read_memory(user.id, memory_id, session)


@memory_router.put("/{memory_id}", operation_id="memoryUpdate")
async def update(memory_id: uuid.UUID, payload: MemoryUpdate, user: AuthedUserDep, session: DBSessionDep) -> Memory:
    return await service.update_memory(user.id, memory_id, payload, session)


@memory_router.delete("/{memory_id}", operation_id="memoryDelete", status_code=204)
async def delete(
    memory_id: uuid.UUID,
    user: AuthedUserDep,
    session: DBSessionDep,
    expected_revision: int = Query(ge=1, le=MAX_REVISION),
) -> Response:
    await service.delete_memory(user.id, memory_id, expected_revision, session)
    return Response(status_code=204)
