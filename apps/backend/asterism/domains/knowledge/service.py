import hashlib
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.files.models import UserFileModel
from asterism.domains.settings.models import LLMModel

from .assignments import AgentKnowledgeBaseAssignmentModel
from .audit import record_knowledge_audit
from .captioning import CaptioningConfiguration, CaptioningError, CaptionMode, bounded_caption
from .embeddings import EmbeddingProvider
from .models import (
    KnowledgeBaseModel,
    KnowledgeCaptionConfigurationModel,
    KnowledgeCaptionMode,
    KnowledgeCaptionStatus,
    KnowledgeDocumentModel,
    KnowledgeDocumentStatus,
)
from .schemas import (
    KnowledgeBase,
    KnowledgeBaseAssignmentList,
    KnowledgeBaseAssignmentReplace,
    KnowledgeBaseCreate,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeCaptionConfiguration,
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeCaptionUpdate,
    KnowledgeDocument,
    KnowledgeDocumentCreate,
    KnowledgeDocumentList,
    KnowledgeDocumentRevisionCreate,
    KnowledgeDocumentUpdate,
)
from .vector_store import VectorChunk, VectorStore


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


async def get_captioning_configuration(*, session: AsyncSession) -> KnowledgeCaptionConfiguration:
    configuration = await session.get(KnowledgeCaptionConfigurationModel, 1)
    if configuration is None:
        # Defensive recovery for databases created before the migration was
        # applied. The singleton invariant remains database-enforced.
        configuration = KnowledgeCaptionConfigurationModel(id=1, mode=KnowledgeCaptionMode.DISABLED)
        session.add(configuration)
        await session.commit()
    return KnowledgeCaptionConfiguration(
        mode=configuration.mode.value,
        provider_model_id=configuration.provider_model_id,
        updated_at=configuration.updated_at,
    )


async def update_captioning_configuration(
    *, payload: KnowledgeCaptionConfigurationUpdate, session: AsyncSession
) -> KnowledgeCaptionConfiguration:
    models = list(await session.scalars(select(LLMModel)))
    try:
        selected = CaptioningConfiguration(mode=CaptionMode(payload.mode), provider_model_id=payload.provider_model_id)
        selected.validate(models)
    except CaptioningError as error:
        raise BadDataException(str(error)) from error

    configuration = await session.get(KnowledgeCaptionConfigurationModel, 1)
    if configuration is None:
        configuration = KnowledgeCaptionConfigurationModel(id=1)
        session.add(configuration)
    configuration.mode = KnowledgeCaptionMode(selected.mode.value)
    configuration.provider_model_id = selected.provider_model_id
    await session.commit()
    return KnowledgeCaptionConfiguration(
        mode=configuration.mode.value,
        provider_model_id=configuration.provider_model_id,
        updated_at=configuration.updated_at,
    )


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
        caption={
            "status": document.caption_status.value if document.caption_status else None,
            "source": document.caption_source.value if document.caption_source else None,
            "model": document.caption_model,
            "text": document.caption_text,
            "error_code": document.caption_error_code,
            "error_reason": document.caption_error_reason,
            "generated_at": document.caption_generated_at,
            "accepted_at": document.caption_accepted_at,
        },
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


def _caption_chunk_id(document: KnowledgeDocumentModel) -> str:
    return hashlib.sha256(f"{document.id}:{document.revision}:caption".encode()).hexdigest()


async def update_knowledge_document_caption(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    document_id: uuid.UUID,
    payload: KnowledgeCaptionUpdate,
    session: AsyncSession,
    embedding_provider: EmbeddingProvider,
    vector_store: VectorStore,
) -> KnowledgeDocument:
    """Accept, edit, or clear one revision's caption without touching image vectors."""
    document = await _owned_document(
        user_id=user_id, knowledge_base_id=knowledge_base_id, document_id=document_id, session=session
    )
    if payload.clear:
        if payload.text is not None or payload.accept:
            raise BadDataException("Clear caption cannot include text or acceptance")
        next_text = None
        next_status = KnowledgeCaptionStatus.CLEARED
        action = "caption.cleared"
    else:
        next_text = bounded_caption(payload.text or document.caption_text or "", 10_000)
        if not payload.accept:
            raise BadDataException("Caption edits must be explicitly accepted")
        next_status = KnowledgeCaptionStatus.ACCEPTED
        action = "caption.accepted"

    chunk_id = _caption_chunk_id(document)
    previous_text = document.caption_text if document.caption_status is KnowledgeCaptionStatus.ACCEPTED else None
    try:
        await vector_store.delete_chunk(user_id=user_id, document_id=str(document.id), chunk_id=chunk_id)
        if next_text is not None:
            vectors = await embedding_provider.embed_text([next_text])
            if len(vectors) != 1:
                raise RuntimeError("Caption embedding provider returned an unexpected result")
            await vector_store.add(
                [
                    VectorChunk(
                        id=chunk_id,
                        user_id=user_id,
                        knowledge_base_id=str(knowledge_base_id),
                        document_id=str(document.id),
                        revision_id=f"{document.id}:{document.revision}",
                        content=next_text,
                        vector=vectors[0],
                    )
                ]
            )
    except Exception as error:
        # Restore the prior accepted caption when its replacement could not be written.
        if previous_text is not None:
            try:
                vectors = await embedding_provider.embed_text([previous_text])
                if len(vectors) == 1:
                    await vector_store.add(
                        [
                            VectorChunk(
                                id=chunk_id,
                                user_id=user_id,
                                knowledge_base_id=str(knowledge_base_id),
                                document_id=str(document.id),
                                revision_id=f"{document.id}:{document.revision}",
                                content=previous_text,
                                vector=vectors[0],
                            )
                        ]
                    )
            except Exception:
                pass
        raise BadDataException("Caption vector could not be updated") from error

    document.caption_text = next_text
    document.caption_status = next_status
    document.caption_accepted_at = get_unix_timestamp() if next_text is not None else None
    document.caption_error_code = None
    document.caption_error_reason = None
    session.add(
        record_knowledge_audit(
            user_id=user_id, action=action, knowledge_base_id=knowledge_base_id, document_id=document_id
        )
    )
    await session.commit()
    return _document_response(document)


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
            knowledge_base_id=knowledge_base_id,
            document_id=document_id,
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
