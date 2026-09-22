import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.files.models import UserFileModel

from .assignments import AgentKnowledgeBaseAssignmentModel
from .audit import record_knowledge_audit
from .models import KnowledgeBaseModel, KnowledgeDocumentModel, KnowledgeDocumentStatus
from .schemas import (
    KnowledgeBase,
    KnowledgeBaseAssignmentList,
    KnowledgeBaseAssignmentReplace,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeDocument,
    KnowledgeDocumentCreate,
    KnowledgeDocumentList,
    KnowledgeDocumentRevisionCreate,
    KnowledgeDocumentUpdate,
)


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise BadDataException("Knowledge base name is required")
    return cleaned


def _clean_description(description: str | None) -> str | None:
    if description is None:
        return None
    cleaned = description.strip()
    return cleaned or None


async def _owned_base(*, user_id: str, knowledge_base_id: uuid.UUID, session: AsyncSession) -> KnowledgeBaseModel:
    knowledge_base = await session.scalar(
        select(KnowledgeBaseModel).where(
            KnowledgeBaseModel.id == knowledge_base_id,
            KnowledgeBaseModel.user_id == user_id,
        )
    )
    if knowledge_base is None:
        # Do not reveal whether a base owned by another user exists.
        raise NotFoundException("Knowledge base not found")
    return knowledge_base


async def create_knowledge_base(*, user_id: str, payload: KnowledgeBaseCreate, session: AsyncSession) -> KnowledgeBase:
    knowledge_base = KnowledgeBaseModel(
        user_id=user_id,
        name=_clean_name(payload.name),
        description=_clean_description(payload.description),
    )
    session.add(knowledge_base)
    session.add(record_knowledge_audit(user_id=user_id, action="base.created"))
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A knowledge base with this name already exists") from error
    return KnowledgeBase.model_validate(knowledge_base)


async def list_knowledge_bases(*, user_id: str, session: AsyncSession, page: int, page_size: int) -> KnowledgeBaseList:
    statement = select(KnowledgeBaseModel).where(KnowledgeBaseModel.user_id == user_id)
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    records = await session.scalars(
        statement.order_by(KnowledgeBaseModel.updated_at.desc(), KnowledgeBaseModel.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return KnowledgeBaseList(
        knowledge_bases=[KnowledgeBase.model_validate(record) for record in records],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def get_knowledge_base(*, user_id: str, knowledge_base_id: uuid.UUID, session: AsyncSession) -> KnowledgeBase:
    return KnowledgeBase.model_validate(
        await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    )


async def update_knowledge_base(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseUpdate,
    session: AsyncSession,
) -> KnowledgeBase:
    knowledge_base = await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    changes = payload.model_fields_set
    if "name" in changes:
        knowledge_base.name = _clean_name(payload.name or "")
    if "description" in changes:
        knowledge_base.description = _clean_description(payload.description)
    session.add(record_knowledge_audit(user_id=user_id, action="base.updated", knowledge_base_id=knowledge_base_id))
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A knowledge base with this name already exists") from error
    return KnowledgeBase.model_validate(knowledge_base)


async def delete_knowledge_base(*, user_id: str, knowledge_base_id: uuid.UUID, session: AsyncSession) -> KnowledgeBase:
    knowledge_base = await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    document_ids = list(
        await session.scalars(
            select(KnowledgeDocumentModel.id).where(
                KnowledgeDocumentModel.knowledge_base_id == knowledge_base_id,
                KnowledgeDocumentModel.user_id == user_id,
            )
        )
    )
    # Source files are user-owned reusable uploads. Removing a base removes only
    # its document references and vectors, never the underlying user file.
    from .runtime import knowledge_ingestion_jobs, vector_store

    for document_id in document_ids:
        knowledge_ingestion_jobs.cancel(str(document_id))
    response = KnowledgeBase.model_validate(knowledge_base)
    session.add(
        record_knowledge_audit(
            user_id=user_id,
            action="base.deleted",
            details={"knowledge_base_id": str(knowledge_base_id)},
        )
    )
    await session.delete(knowledge_base)
    await session.commit()
    await vector_store.delete_knowledge_base(user_id=user_id, knowledge_base_id=str(knowledge_base_id))
    return response


async def _next_document_position(*, knowledge_base_id: uuid.UUID, session: AsyncSession) -> int:
    highest = await session.scalar(
        select(func.max(KnowledgeDocumentModel.position)).where(
            KnowledgeDocumentModel.knowledge_base_id == knowledge_base_id
        )
    )
    return (highest or 0) + 1


def _document_response(document: KnowledgeDocumentModel) -> KnowledgeDocument:
    return KnowledgeDocument(
        id=document.id,
        knowledge_base_id=document.knowledge_base_id,
        file_id=document.file_id,
        original_name=document.original_name,
        mime_type=document.mime_type,
        content_sha256=document.content_sha256,
        revision=document.revision,
        position=document.position,
        status=document.status.value,
        error=document.error,
        indexed_at=document.indexed_at,
        replaces_document_id=document.replaces_document_id,
        metadata=document.metadata_,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


async def _owned_document(
    *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID, session: AsyncSession
) -> KnowledgeDocumentModel:
    document = await session.scalar(
        select(KnowledgeDocumentModel).where(
            KnowledgeDocumentModel.id == document_id,
            KnowledgeDocumentModel.knowledge_base_id == knowledge_base_id,
            KnowledgeDocumentModel.user_id == user_id,
        )
    )
    if document is None:
        raise NotFoundException("Knowledge document not found")
    return document


async def add_knowledge_document(
    *, user_id: str, knowledge_base_id: uuid.UUID, payload: KnowledgeDocumentCreate, session: AsyncSession
) -> KnowledgeDocument:
    await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    file = await session.scalar(
        select(UserFileModel).where(UserFileModel.id == payload.file_id, UserFileModel.user_id == user_id)
    )
    if file is None:
        raise NotFoundException("File not found")
    document = KnowledgeDocumentModel(
        knowledge_base_id=knowledge_base_id,
        user_id=user_id,
        file_id=file.id,
        original_name=file.original_name,
        mime_type=file.mime_type,
        content_sha256=file.sha256,
        revision=1,
        position=await _next_document_position(knowledge_base_id=knowledge_base_id, session=session),
        status=KnowledgeDocumentStatus.PENDING,
        metadata_=payload.metadata,
    )
    session.add(document)
    session.add(
        record_knowledge_audit(
            user_id=user_id,
            action="document.created",
            knowledge_base_id=knowledge_base_id,
            document_id=document.id,
            details={"file_id": str(file.id), "revision": document.revision},
        )
    )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "This file is already attached to the knowledge base") from error
    return _document_response(document)


async def create_knowledge_document_revision(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: KnowledgeDocumentRevisionCreate,
    session: AsyncSession,
) -> KnowledgeDocument:
    previous = await _owned_document(
        user_id=user_id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        session=session,
    )
    file = await session.scalar(
        select(UserFileModel).where(UserFileModel.id == payload.file_id, UserFileModel.user_id == user_id)
    )
    if file is None:
        raise NotFoundException("File not found")
    document = KnowledgeDocumentModel(
        knowledge_base_id=knowledge_base_id,
        user_id=user_id,
        file_id=file.id,
        original_name=file.original_name,
        mime_type=file.mime_type,
        content_sha256=file.sha256,
        revision=previous.revision + 1,
        position=await _next_document_position(knowledge_base_id=knowledge_base_id, session=session),
        status=KnowledgeDocumentStatus.PENDING,
        replaces_document_id=previous.id,
        metadata_=previous.metadata_ if payload.metadata is None else payload.metadata,
    )
    session.add(document)
    session.add(
        record_knowledge_audit(
            user_id=user_id,
            action="document.revision_created",
            knowledge_base_id=knowledge_base_id,
            document_id=document.id,
            details={"file_id": str(file.id), "revision": document.revision},
        )
    )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "This file is already attached to the knowledge base") from error
    return _document_response(document)


async def list_knowledge_documents(
    *, user_id: str, knowledge_base_id: uuid.UUID, session: AsyncSession, page: int, page_size: int
) -> KnowledgeDocumentList:
    await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    statement = select(KnowledgeDocumentModel).where(
        KnowledgeDocumentModel.knowledge_base_id == knowledge_base_id,
        KnowledgeDocumentModel.user_id == user_id,
    )
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    records = await session.scalars(
        statement.order_by(KnowledgeDocumentModel.position, KnowledgeDocumentModel.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return KnowledgeDocumentList(
        documents=[_document_response(record) for record in records],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def get_knowledge_document(
    *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID, session: AsyncSession
) -> KnowledgeDocument:
    return _document_response(
        await _owned_document(
            user_id=user_id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=session
        )
    )


async def update_knowledge_document_metadata(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: KnowledgeDocumentUpdate,
    session: AsyncSession,
) -> KnowledgeDocument:
    document = await _owned_document(
        user_id=user_id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=session
    )
    document.metadata_ = payload.metadata
    session.add(
        record_knowledge_audit(
            user_id=user_id,
            action="document.metadata_updated",
            knowledge_base_id=knowledge_base_id,
            document_id=document_id,
        )
    )
    await session.commit()
    return _document_response(document)


async def request_knowledge_document_ingestion(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    document_id: uuid.UUID,
    reindex: bool,
    session: AsyncSession,
) -> KnowledgeDocument:
    document = await _owned_document(
        user_id=user_id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=session
    )
    if reindex:
        document.status = KnowledgeDocumentStatus.PENDING
        document.error = None
        document.indexed_at = None
        await session.commit()
    if document.status is not KnowledgeDocumentStatus.READY:
        session.add(
            record_knowledge_audit(
                user_id=user_id,
                action="document.ingestion_requested",
                knowledge_base_id=knowledge_base_id,
                document_id=document_id,
                details={"reindex": int(reindex)},
            )
        )
        await session.commit()
        from .runtime import knowledge_ingestion_jobs

        knowledge_ingestion_jobs.enqueue(
            user_id=user_id,
            knowledge_base_id=str(knowledge_base_id),
            document_id=str(document_id),
        )
    return _document_response(document)


async def cancel_knowledge_document_ingestion(
    *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID, session: AsyncSession
) -> KnowledgeDocument:
    document = await _owned_document(
        user_id=user_id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=session
    )
    from .runtime import knowledge_ingestion_jobs

    if knowledge_ingestion_jobs.cancel(str(document_id)):
        document.status = KnowledgeDocumentStatus.PENDING
        document.error = "Indexing cancelled"
        document.indexed_at = None
        session.add(
            record_knowledge_audit(
                user_id=user_id,
                action="document.ingestion_cancelled",
                knowledge_base_id=knowledge_base_id,
                document_id=document_id,
            )
        )
        await session.commit()
    return _document_response(document)


async def get_agent_knowledge_base_assignments(
    *, user_id: str, agent_id: uuid.UUID, session: AsyncSession
) -> KnowledgeBaseAssignmentList:
    agent = await session.scalar(
        select(AgentProfileModel).where(AgentProfileModel.id == agent_id, AgentProfileModel.user_id == user_id)
    )
    if agent is None:
        raise NotFoundException("Agent not found")
    assignments = await session.scalars(
        select(AgentKnowledgeBaseAssignmentModel.knowledge_base_id)
        .where(
            AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
            AgentKnowledgeBaseAssignmentModel.user_id == user_id,
        )
        .order_by(AgentKnowledgeBaseAssignmentModel.position)
    )
    return KnowledgeBaseAssignmentList(knowledge_base_ids=list(assignments))


async def replace_agent_knowledge_base_assignments(
    *,
    user_id: str,
    agent_id: uuid.UUID,
    payload: KnowledgeBaseAssignmentReplace,
    session: AsyncSession,
) -> KnowledgeBaseAssignmentList:
    agent = await session.scalar(
        select(AgentProfileModel).where(AgentProfileModel.id == agent_id, AgentProfileModel.user_id == user_id)
    )
    if agent is None:
        raise NotFoundException("Agent not found")
    base_ids = payload.knowledge_base_ids
    if len(set(base_ids)) != len(base_ids):
        raise BadDataException("Knowledge base assignments must not contain duplicates")
    if base_ids:
        owned_ids = set(
            await session.scalars(
                select(KnowledgeBaseModel.id).where(
                    KnowledgeBaseModel.user_id == user_id,
                    KnowledgeBaseModel.id.in_(base_ids),
                )
            )
        )
        if owned_ids != set(base_ids):
            raise NotFoundException("Knowledge base not found")
        ready_ids = set(
            await session.scalars(
                select(KnowledgeDocumentModel.knowledge_base_id)
                .where(
                    KnowledgeDocumentModel.user_id == user_id,
                    KnowledgeDocumentModel.knowledge_base_id.in_(base_ids),
                    KnowledgeDocumentModel.status == KnowledgeDocumentStatus.READY,
                )
                .distinct()
            )
        )
        if ready_ids != set(base_ids):
            raise BadDataException("Knowledge bases must contain a ready document before assignment")
    await session.execute(
        delete(AgentKnowledgeBaseAssignmentModel).where(
            AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
            AgentKnowledgeBaseAssignmentModel.user_id == user_id,
        )
    )
    session.add_all(
        [
            AgentKnowledgeBaseAssignmentModel(
                user_id=user_id, agent_id=agent_id, knowledge_base_id=base_id, position=position
            )
            for position, base_id in enumerate(base_ids)
        ]
    )
    await session.commit()
    return KnowledgeBaseAssignmentList(knowledge_base_ids=base_ids)


async def delete_knowledge_document(
    *, user_id: str, knowledge_base_id: uuid.UUID, document_id: uuid.UUID, session: AsyncSession
) -> KnowledgeDocument:
    document = await _owned_document(
        user_id=user_id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=session
    )
    # See base deletion: document removal releases only this reference, not the
    # user-owned source upload, which may be attached elsewhere.
    from .runtime import knowledge_ingestion_jobs, vector_store

    knowledge_ingestion_jobs.cancel(str(document_id))
    response = _document_response(document)
    session.add(
        record_knowledge_audit(
            user_id=user_id,
            action="document.deleted",
            details={"document_id": str(document_id)},
        )
    )
    await session.delete(document)
    await session.commit()
    await vector_store.delete_document(user_id=user_id, document_id=str(document_id))
    return response
