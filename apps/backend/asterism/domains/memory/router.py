"""The signed-in person's own memories (ADR-0078). There is no route to anyone else's."""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.common.log import get_logger
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from . import admin, policy, service
from .models import MemoryKind
from .schemas import (
    MAX_REVISION,
    Memory,
    MemoryAvailability,
    MemoryCreate,
    MemoryDeleteAll,
    MemoryPage,
    MemoryPolicy,
    MemoryUpdate,
)

logger = get_logger("Memory")

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


@memory_router.get("/availability", operation_id="memoryAvailability")
async def get_availability(
    user: AuthedUserDep,
    session: DBSessionDep,
    chat_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
) -> MemoryAvailability:
    """Whether memory is used in this chat (or a new chat in this project), and which switch is off."""
    if chat_id is not None:
        return await policy.chat_memory_available(user.id, chat_id, session)
    return await policy.memory_available(user.id, session, project_id=project_id)


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


memory_policy_router = APIRouter(
    prefix="/settings/app/memory",
    tags=["memories"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
)


@memory_policy_router.get("", operation_id="memoryPolicyGet")
async def get_policy(user: AdminUserDep, session: DBSessionDep) -> MemoryPolicy:
    return await policy.read_policy(session)


@memory_policy_router.put("", operation_id="memoryPolicyUpdate")
async def put_policy(payload: MemoryPolicy, user: AdminUserDep, session: DBSessionDep) -> MemoryPolicy:
    result = await admin.write_policy(payload, session)
    logger.info(f"Memory policy set by admin {user.id}: enabled={result.enabled} groups={result.group_ids}")
    return result
