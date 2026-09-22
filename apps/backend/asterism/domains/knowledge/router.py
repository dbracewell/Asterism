import uuid

from fastapi import APIRouter, Query, status

import asterism.domains.knowledge.service as knowledge_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import (
    KnowledgeBase,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentCreate,
    KnowledgeDocumentList,
    KnowledgeDocumentRevisionCreate,
    KnowledgeDocumentUpdate,
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
    responses={409: {"model": ErrorDetail}},
)
async def create_knowledge_base(payload: KnowledgeBaseCreate, user: AuthedUserDep, db: DBSessionDep) -> KnowledgeBase:
    return await knowledge_service.create_knowledge_base(user_id=user.id, payload=payload, session=db)


@knowledge_router.get("/", response_model=KnowledgeBaseList, operation_id="knowledgeBaseGetMany")
async def list_knowledge_bases(
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> KnowledgeBaseList:
    return await knowledge_service.list_knowledge_bases(user_id=user.id, session=db, page=page, page_size=page_size)


@knowledge_router.post(
    "/{knowledge_base_id}/documents",
    response_model=KnowledgeDocument,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledgeDocumentCreate",
    responses={409: {"model": ErrorDetail}},
)
async def add_knowledge_document(
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeDocumentCreate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeDocument:
    return await knowledge_service.add_knowledge_document(
        user_id=user.id, knowledge_base_id=knowledge_base_id, payload=payload, session=db
    )


@knowledge_router.post(
    "/{knowledge_base_id}/documents/{document_id}/revisions",
    response_model=KnowledgeDocument,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledgeDocumentCreateRevision",
    responses={409: {"model": ErrorDetail}},
)
async def create_knowledge_document_revision(
    knowledge_base_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: KnowledgeDocumentRevisionCreate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeDocument:
    return await knowledge_service.create_knowledge_document_revision(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        payload=payload,
        session=db,
    )


@knowledge_router.get(
    "/{knowledge_base_id}/documents",
    response_model=KnowledgeDocumentList,
    operation_id="knowledgeDocumentGetMany",
)
async def list_knowledge_documents(
    knowledge_base_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> KnowledgeDocumentList:
    return await knowledge_service.list_knowledge_documents(
        user_id=user.id, knowledge_base_id=knowledge_base_id, session=db, page=page, page_size=page_size
    )


@knowledge_router.get(
    "/{knowledge_base_id}/documents/{document_id}",
    response_model=KnowledgeDocument,
    operation_id="knowledgeDocumentGetOne",
)
async def get_knowledge_document(
    knowledge_base_id: uuid.UUID, document_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> KnowledgeDocument:
    return await knowledge_service.get_knowledge_document(
        user_id=user.id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=db
    )


@knowledge_router.patch(
    "/{knowledge_base_id}/documents/{document_id}",
    response_model=KnowledgeDocument,
    operation_id="knowledgeDocumentUpdateMetadata",
)
async def update_knowledge_document_metadata(
    knowledge_base_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: KnowledgeDocumentUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeDocument:
    return await knowledge_service.update_knowledge_document_metadata(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        payload=payload,
        session=db,
    )


@knowledge_router.post(
    "/{knowledge_base_id}/documents/{document_id}/ingest",
    response_model=KnowledgeDocument,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="knowledgeDocumentIngest",
)
async def ingest_knowledge_document(
    knowledge_base_id: uuid.UUID, document_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> KnowledgeDocument:
    return await knowledge_service.request_knowledge_document_ingestion(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        reindex=False,
        session=db,
    )


@knowledge_router.post(
    "/{knowledge_base_id}/documents/{document_id}/reindex",
    response_model=KnowledgeDocument,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="knowledgeDocumentReindex",
)
async def reindex_knowledge_document(
    knowledge_base_id: uuid.UUID, document_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> KnowledgeDocument:
    return await knowledge_service.request_knowledge_document_ingestion(
        user_id=user.id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        reindex=True,
        session=db,
    )


@knowledge_router.post(
    "/{knowledge_base_id}/documents/{document_id}/cancel",
    response_model=KnowledgeDocument,
    operation_id="knowledgeDocumentCancelIngestion",
)
async def cancel_knowledge_document_ingestion(
    knowledge_base_id: uuid.UUID, document_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> KnowledgeDocument:
    return await knowledge_service.cancel_knowledge_document_ingestion(
        user_id=user.id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=db
    )


@knowledge_router.delete(
    "/{knowledge_base_id}/documents/{document_id}",
    response_model=KnowledgeDocument,
    operation_id="knowledgeDocumentDelete",
)
async def delete_knowledge_document(
    knowledge_base_id: uuid.UUID, document_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> KnowledgeDocument:
    return await knowledge_service.delete_knowledge_document(
        user_id=user.id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=db
    )


@knowledge_router.get("/{knowledge_base_id}", response_model=KnowledgeBase, operation_id="knowledgeBaseGetOne")
async def get_knowledge_base(knowledge_base_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> KnowledgeBase:
    return await knowledge_service.get_knowledge_base(user_id=user.id, knowledge_base_id=knowledge_base_id, session=db)


@knowledge_router.patch(
    "/{knowledge_base_id}",
    response_model=KnowledgeBase,
    operation_id="knowledgeBaseUpdate",
    responses={409: {"model": ErrorDetail}},
)
async def update_knowledge_base(
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> KnowledgeBase:
    return await knowledge_service.update_knowledge_base(
        user_id=user.id, knowledge_base_id=knowledge_base_id, payload=payload, session=db
    )


@knowledge_router.delete("/{knowledge_base_id}", response_model=KnowledgeBase, operation_id="knowledgeBaseDelete")
async def delete_knowledge_base(knowledge_base_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> KnowledgeBase:
    return await knowledge_service.delete_knowledge_base(
        user_id=user.id, knowledge_base_id=knowledge_base_id, session=db
    )
