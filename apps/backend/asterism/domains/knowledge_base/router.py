import uuid
from typing import Literal

from fastapi import APIRouter, Query, status

import asterism.domains.knowledge_base.service as knowledge_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseFile,
    KnowledgeBaseFileCreate,
    KnowledgeBaseFileList,
    KnowledgeBaseFileReorder,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
)

knowledge_router = APIRouter(
    prefix="/knowledge-bases",
    tags=["knowledge-bases"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@knowledge_router.post(
    "/",
    response_model=KnowledgeBase,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledgeBaseCreate",
)
async def create_knowledge_base(payload: KnowledgeBaseCreate, user: AuthedUserDep, db: DBSessionDep) -> KnowledgeBase:
    return await knowledge_service.create_knowledge_base(user_id=user.id, payload=payload, session=db)


@knowledge_router.get("/", response_model=KnowledgeBaseList, operation_id="knowledgeBaseGetMany")
async def list_knowledge_bases(
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    sort_by: Literal["name", "created"] = Query(default="name"),
    query: str | None = Query(default=None, description="Search knowledge bases by name or description"),
) -> KnowledgeBaseList:
    return await knowledge_service.list_knowledge_bases(
        user_id=user.id,
        session=db,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        query=query,
    )


@knowledge_router.post(
    "/{knowledge_base_id}/files",
    response_model=KnowledgeBaseFile,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledgeBaseFileCreate",
    responses={409: {"model": ErrorDetail}},
)
async def add_knowledge_base_file(
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseFileCreate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeBaseFile:
    return await knowledge_service.add_knowledge_base_file(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        payload=payload,
        session=db,
    )


@knowledge_router.get(
    "/{knowledge_base_id}/files",
    response_model=KnowledgeBaseFileList,
    operation_id="knowledgeBaseFileGetMany",
)
async def list_knowledge_base_files(
    knowledge_base_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> KnowledgeBaseFileList:
    return await knowledge_service.list_knowledge_base_files(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        session=db,
        page=page,
        page_size=page_size,
    )


@knowledge_router.put(
    "/{knowledge_base_id}/files/order",
    response_model=KnowledgeBaseFileList,
    operation_id="knowledgeBaseFileReorder",
)
async def reorder_knowledge_base_files(
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseFileReorder,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeBaseFileList:
    return await knowledge_service.reorder_knowledge_base_files(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        payload=payload,
        session=db,
    )


@knowledge_router.delete(
    "/{knowledge_base_id}/files/{membership_id}",
    response_model=KnowledgeBaseFile,
    operation_id="knowledgeBaseFileDelete",
)
async def remove_knowledge_base_file(
    knowledge_base_id: uuid.UUID,
    membership_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeBaseFile:
    return await knowledge_service.remove_knowledge_base_file(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        membership_id=membership_id,
        session=db,
    )


@knowledge_router.get("/{knowledge_base_id}", response_model=KnowledgeBase, operation_id="knowledgeBaseGetOne")
async def get_knowledge_base(knowledge_base_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> KnowledgeBase:
    return await knowledge_service.get_knowledge_base(user_id=user.id, knowledge_base_id=knowledge_base_id, session=db)


@knowledge_router.patch("/{knowledge_base_id}", response_model=KnowledgeBase, operation_id="knowledgeBaseUpdate")
async def update_knowledge_base(
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeBase:
    return await knowledge_service.update_knowledge_base(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        payload=payload,
        session=db,
    )


@knowledge_router.delete("/{knowledge_base_id}", response_model=KnowledgeBase, operation_id="knowledgeBaseDelete")
async def delete_knowledge_base(knowledge_base_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> KnowledgeBase:
    return await knowledge_service.delete_knowledge_base(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        session=db,
    )
