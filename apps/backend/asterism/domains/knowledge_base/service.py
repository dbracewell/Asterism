import hashlib
import json
import uuid
from typing import Literal

from pydantic import ValidationError
from sqlalchemy import delete, func, select, true
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.domains.agent.models import AgentProfileModel
from asterism.domains.extraction.captioning import CaptioningConfiguration, CaptioningError, CaptionMode
from asterism.domains.extraction.models import FileExtractionModel, FileKnowledgeArtifactStatus
from asterism.domains.extraction.runtime import start_file_ingestion_job
from asterism.domains.files.models import UserFileModel
from asterism.domains.settings.models import ApplicationSettingsModel, LLMModel

from .models import (
    AgentKnowledgeBaseAssignmentModel,
    KnowledgeBaseFileModel,
    KnowledgeBaseModel,
)
from .schemas import (
    KnowledgeBase,
    KnowledgeBaseAssignmentList,
    KnowledgeBaseAssignmentReplace,
    KnowledgeBaseCreate,
    KnowledgeBaseFile,
    KnowledgeBaseFileCreate,
    KnowledgeBaseFileList,
    KnowledgeBaseFileReorder,
    KnowledgeBaseList,
    KnowledgeBaseUpdate,
    KnowledgeCaptionConfiguration,
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeProcessingCaptioningConfiguration,
    KnowledgeProcessingConfiguration,
    KnowledgeProcessingProfile,
    KnowledgeProcessingProfileUpdate,
    KnowledgeReprocessSummary,
)

KNOWLEDGE_PROCESSING_SETTING_KEY = "knowledge.processing"


def _processing_identity(
    *,
    extraction_policy: str,
    chunking_policy: str,
    embedding_model: str,
    captioning_policy: str,
    captioning: KnowledgeProcessingCaptioningConfiguration,
) -> str:
    """Fingerprint every input that can change a derived knowledge artifact."""
    content = {
        "extraction_policy": extraction_policy,
        "chunking_policy": chunking_policy,
        "embedding_model": embedding_model,
        "captioning_policy": captioning_policy,
        "captioning": captioning.model_dump(mode="json"),
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _default_processing_configuration() -> KnowledgeProcessingConfiguration:
    captioning = KnowledgeProcessingCaptioningConfiguration()
    return KnowledgeProcessingConfiguration(
        identity=_processing_identity(
            extraction_policy="text-extraction-v1",
            chunking_policy="bounded-chunking-v1",
            embedding_model="onnx-clip-v1",
            captioning_policy="captioning-configuration-v1",
            captioning=captioning,
        ),
        extraction_policy="text-extraction-v1",
        chunking_policy="bounded-chunking-v1",
        embedding_model="onnx-clip-v1",
        captioning_policy="captioning-configuration-v1",
        captioning=captioning,
    )


async def _load_processing_configuration(
    *,
    session: AsyncSession,
) -> tuple[ApplicationSettingsModel | None, KnowledgeProcessingConfiguration]:
    """Read the versioned setting, falling back safely for missing or invalid values."""
    setting = await session.get(ApplicationSettingsModel, KNOWLEDGE_PROCESSING_SETTING_KEY)
    if setting is None:
        return None, _default_processing_configuration()
    try:
        return setting, KnowledgeProcessingConfiguration.model_validate(setting.value)
    except ValidationError:
        # Do not make retrieval or file processing unavailable because a manual
        # settings edit is malformed. A subsequent administrator update heals it.
        return setting, _default_processing_configuration()


def _profile_from_configuration(
    configuration: KnowledgeProcessingConfiguration,
    *,
    updated_at: int,
) -> KnowledgeProcessingProfile:
    return KnowledgeProcessingProfile(
        generation=configuration.generation,
        identity=configuration.identity,
        extraction_policy=configuration.extraction_policy,
        chunking_policy=configuration.chunking_policy,
        embedding_model=configuration.embedding_model,
        captioning_policy=configuration.captioning_policy,
        updated_at=updated_at,
    )


def _save_processing_configuration(
    *,
    setting: ApplicationSettingsModel | None,
    configuration: KnowledgeProcessingConfiguration,
    session: AsyncSession,
) -> ApplicationSettingsModel:
    if setting is None:
        setting = ApplicationSettingsModel(
            key=KNOWLEDGE_PROCESSING_SETTING_KEY,
            value=configuration.model_dump(mode="json"),
        )
        session.add(setting)
    else:
        setting.value = configuration.model_dump(mode="json")
    return setting


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
        ),
    )
    if knowledge_base is None:
        # Do not reveal whether a base owned by another user exists.
        raise NotFoundException("Knowledge base not found")
    return knowledge_base


async def ensure_file_knowledge_artifact(*, file: UserFileModel, session: AsyncSession) -> FileExtractionModel:
    """Create the one pending canonical artifact for a newly eligible file.

    A pending replacement is deliberately *not* current: retrieval can retain
    an older ready generation until processing succeeds.
    """
    _, configuration = await _load_processing_configuration(session=session)
    existing = await session.scalar(
        select(FileExtractionModel).where(
            FileExtractionModel.file_id == file.id,
            FileExtractionModel.processing_profile_generation == configuration.generation,
        ),
    )
    if existing is not None:
        return existing
    generation = (
        await session.scalar(
            select(func.max(FileExtractionModel.generation)).where(
                FileExtractionModel.file_id == file.id,
            ),
        )
        or 0
    ) + 1
    artifact = FileExtractionModel(
        user_id=file.user_id,
        file_id=file.id,
        generation=generation,
        processing_profile_generation=configuration.generation,
        processing_profile_identity=configuration.identity,
        status=FileKnowledgeArtifactStatus.PENDING,
        is_current=False,
    )
    session.add(artifact)
    return artifact


def _with_resolved_identity(configuration: KnowledgeProcessingConfiguration) -> KnowledgeProcessingConfiguration:
    """Return a policy whose identity covers every processing-relevant input."""
    identity = _processing_identity(
        extraction_policy=configuration.extraction_policy,
        chunking_policy=configuration.chunking_policy,
        embedding_model=configuration.embedding_model,
        captioning_policy=configuration.captioning_policy,
        captioning=configuration.captioning,
    )
    return configuration.model_copy(update={"identity": identity})


async def _transition_processing_configuration(
    *,
    candidate: KnowledgeProcessingConfiguration,
    session: AsyncSession,
) -> KnowledgeReprocessSummary:
    """Atomically persist a changed policy, then schedule durable replacements.

    Scheduling deliberately happens only after commit.  If scheduling is
    interrupted, the persisted pending generations are restart-recoverable and
    a ready current generation remains available for retrieval.
    """
    setting, current = await _load_processing_configuration(session=session)
    candidate = _with_resolved_identity(candidate)
    if candidate.identity == current.identity:
        # An explicit write of the default policy heals the previously missing
        # setting without creating needless artifact generations.
        if setting is None:
            setting = _save_processing_configuration(setting=None, configuration=candidate, session=session)
            await session.commit()
        return KnowledgeReprocessSummary(
            profile=_profile_from_configuration(current, updated_at=setting.updated_at if setting else 0),
            queued_file_count=0,
        )
    candidate = candidate.model_copy(update={"generation": current.generation + 1})
    setting = _save_processing_configuration(setting=setting, configuration=candidate, session=session)
    files = list(await session.scalars(select(UserFileModel)))
    replacements = [await ensure_file_knowledge_artifact(file=file, session=session) for file in files]
    await session.commit()

    for file, artifact in zip(files, replacements, strict=True):
        start_file_ingestion_job(user_id=file.user_id, file_id=file.id, artifact_id=artifact.id)
    return KnowledgeReprocessSummary(
        profile=_profile_from_configuration(candidate, updated_at=setting.updated_at),
        queued_file_count=len(replacements),
    )


async def update_processing_profile_and_reprocess(
    *,
    payload: KnowledgeProcessingProfileUpdate,
    session: AsyncSession,
) -> KnowledgeReprocessSummary:
    """Apply a processing-policy edit through the one transition path."""
    _, current = await _load_processing_configuration(session=session)
    return await _transition_processing_configuration(
        candidate=current.model_copy(
            update={
                "extraction_policy": payload.extraction_policy,
                "chunking_policy": payload.chunking_policy,
                "embedding_model": payload.embedding_model,
                "captioning_policy": payload.captioning_policy,
            },
        ),
        session=session,
    )


async def get_captioning_configuration(*, session: AsyncSession) -> KnowledgeCaptionConfiguration:
    setting, configuration = await _load_processing_configuration(session=session)
    return KnowledgeCaptionConfiguration(
        mode=configuration.captioning.mode,
        provider_model_id=configuration.captioning.provider_model_id,
        updated_at=setting.updated_at if setting else 0,
    )


async def ensure_captioning_selection_is_valid(*, session: AsyncSession) -> None:
    """Reject a provider/model edit that would orphan the selected captioner."""
    _, configuration = await _load_processing_configuration(session=session)
    try:
        CaptioningConfiguration(
            mode=CaptionMode(configuration.captioning.mode),
            provider_model_id=configuration.captioning.provider_model_id,
        ).validate(list(await session.scalars(select(LLMModel).join(LLMModel.provider))))
    except CaptioningError as error:
        raise BadDataException(
            "Cannot remove or make ineligible the provider model selected for image captioning",
        ) from error


async def update_captioning_configuration(
    *,
    payload: KnowledgeCaptionConfigurationUpdate,
    session: AsyncSession,
) -> KnowledgeCaptionConfiguration:
    models = list(await session.scalars(select(LLMModel)))
    try:
        selected = CaptioningConfiguration(
            mode=CaptionMode(payload.mode),
            provider_model_id=payload.provider_model_id,
        )
        selected.validate(models)  # pyright: ignore[reportArgumentType]
    except CaptioningError as error:
        raise BadDataException(str(error)) from error

    _, configuration = await _load_processing_configuration(session=session)
    updated_configuration = configuration.model_copy(
        update={
            "captioning": KnowledgeProcessingCaptioningConfiguration(
                mode=selected.mode.value,
                provider_model_id=selected.provider_model_id,
            ),
        },
    )
    transition = await _transition_processing_configuration(
        candidate=updated_configuration,
        session=session,
    )
    return KnowledgeCaptionConfiguration(
        mode=updated_configuration.captioning.mode,
        provider_model_id=updated_configuration.captioning.provider_model_id,
        updated_at=transition.profile.updated_at,
    )


async def create_knowledge_base(*, user_id: str, payload: KnowledgeBaseCreate, session: AsyncSession) -> KnowledgeBase:
    knowledge_base = KnowledgeBaseModel(
        user_id=user_id,
        name=_clean_name(payload.name),
        description=_clean_description(payload.description),
    )
    session.add(knowledge_base)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A knowledge base with this name already exists") from error
    return KnowledgeBase.model_validate(knowledge_base)


async def list_knowledge_bases(
    *,
    user_id: str,
    session: AsyncSession,
    page: int,
    page_size: int,
    sort_by: Literal["name", "created"] = "name",
    query: str | None = None,
) -> KnowledgeBaseList:
    search = query.strip() if query else None
    statement = select(KnowledgeBaseModel).where(
        KnowledgeBaseModel.user_id == user_id,
        (
            KnowledgeBaseModel.name.ilike(f"%{search}%") | KnowledgeBaseModel.description.ilike(f"%{search}%")
            if search
            else true()
        ),
    )
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    order_by = (
        (KnowledgeBaseModel.created_at.desc(), KnowledgeBaseModel.name)
        if sort_by == "created"
        else (KnowledgeBaseModel.name, KnowledgeBaseModel.created_at.desc())
    )
    records = await session.scalars(statement.order_by(*order_by).offset((page - 1) * page_size).limit(page_size))
    return KnowledgeBaseList(
        knowledge_bases=[KnowledgeBase.model_validate(record) for record in records],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def get_knowledge_base(*, user_id: str, knowledge_base_id: uuid.UUID, session: AsyncSession) -> KnowledgeBase:
    return KnowledgeBase.model_validate(
        await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session),
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
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "A knowledge base with this name already exists") from error
    return KnowledgeBase.model_validate(knowledge_base)


async def delete_knowledge_base(*, user_id: str, knowledge_base_id: uuid.UUID, session: AsyncSession) -> KnowledgeBase:
    knowledge_base = await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    response = KnowledgeBase.model_validate(knowledge_base)
    await session.delete(knowledge_base)
    await session.commit()
    return response


async def _next_file_position(*, knowledge_base_id: uuid.UUID, session: AsyncSession) -> int:
    highest = await session.scalar(
        select(func.max(KnowledgeBaseFileModel.position)).where(
            KnowledgeBaseFileModel.knowledge_base_id == knowledge_base_id,
        ),
    )
    return (highest or 0) + 1


async def add_knowledge_base_file(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseFileCreate,
    session: AsyncSession,
) -> KnowledgeBaseFile:
    """Attach an owned library file without creating or queuing any artifact."""
    await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    file = await session.scalar(
        select(UserFileModel.id).where(UserFileModel.id == payload.file_id, UserFileModel.user_id == user_id),
    )
    if file is None:
        raise NotFoundException("File not found")
    membership = KnowledgeBaseFileModel(
        knowledge_base_id=knowledge_base_id,
        file_id=payload.file_id,
        position=await _next_file_position(knowledge_base_id=knowledge_base_id, session=session),
    )
    session.add(membership)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise CodedException(409, "This file is already attached to the knowledge base") from error
    return KnowledgeBaseFile.model_validate(membership)


async def list_knowledge_base_files(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    session: AsyncSession,
    page: int,
    page_size: int,
) -> KnowledgeBaseFileList:
    await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    statement = select(KnowledgeBaseFileModel).where(KnowledgeBaseFileModel.knowledge_base_id == knowledge_base_id)
    total = await session.scalar(select(func.count()).select_from(statement.subquery()))
    records = await session.scalars(
        statement.order_by(KnowledgeBaseFileModel.position, KnowledgeBaseFileModel.id)
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    return KnowledgeBaseFileList(
        files=[KnowledgeBaseFile.model_validate(record) for record in records],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


async def remove_knowledge_base_file(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    membership_id: uuid.UUID,
    session: AsyncSession,
) -> KnowledgeBaseFile:
    await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    membership = await session.scalar(
        select(KnowledgeBaseFileModel).where(
            KnowledgeBaseFileModel.id == membership_id,
            KnowledgeBaseFileModel.knowledge_base_id == knowledge_base_id,
        ),
    )
    if membership is None:
        raise NotFoundException("Knowledge base file membership not found")
    response = KnowledgeBaseFile.model_validate(membership)
    await session.delete(membership)
    await session.commit()
    return response


async def reorder_knowledge_base_files(
    *,
    user_id: str,
    knowledge_base_id: uuid.UUID,
    payload: KnowledgeBaseFileReorder,
    session: AsyncSession,
) -> KnowledgeBaseFileList:
    await _owned_base(user_id=user_id, knowledge_base_id=knowledge_base_id, session=session)
    memberships = list(
        await session.scalars(
            select(KnowledgeBaseFileModel).where(KnowledgeBaseFileModel.knowledge_base_id == knowledge_base_id),
        ),
    )
    if len(payload.membership_ids) != len(memberships) or set(payload.membership_ids) != {
        item.id for item in memberships
    }:
        raise BadDataException("Reorder must include every membership exactly once")
    by_id = {item.id: item for item in memberships}
    for position, membership_id in enumerate(payload.membership_ids, start=1):
        by_id[membership_id].position = -position
    await session.flush()
    for position, membership_id in enumerate(payload.membership_ids, start=1):
        by_id[membership_id].position = position
    await session.commit()
    ordered = [by_id[membership_id] for membership_id in payload.membership_ids]
    return KnowledgeBaseFileList(
        files=[KnowledgeBaseFile.model_validate(item) for item in ordered],
        total=len(ordered),
        page=1,
        page_size=len(ordered),
    )


async def get_agent_knowledge_base_assignments(
    *,
    user_id: str,
    agent_id: uuid.UUID,
    session: AsyncSession,
) -> KnowledgeBaseAssignmentList:
    agent = await session.scalar(
        select(AgentProfileModel).where(AgentProfileModel.id == agent_id, AgentProfileModel.user_id == user_id),
    )
    if agent is None:
        raise NotFoundException("Agent not found")
    assignments = await session.scalars(
        select(AgentKnowledgeBaseAssignmentModel.knowledge_base_id)
        .where(
            AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
            AgentKnowledgeBaseAssignmentModel.user_id == user_id,
        )
        .order_by(AgentKnowledgeBaseAssignmentModel.position),
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
        select(AgentProfileModel).where(AgentProfileModel.id == agent_id, AgentProfileModel.user_id == user_id),
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
                ),
            ),
        )
        if owned_ids != set(base_ids):
            raise NotFoundException("Knowledge base not found")
        ready_ids = set(
            await session.scalars(
                select(KnowledgeBaseFileModel.knowledge_base_id)
                .join(
                    FileExtractionModel,
                    FileExtractionModel.file_id == KnowledgeBaseFileModel.file_id,
                )
                .where(
                    KnowledgeBaseFileModel.knowledge_base_id.in_(base_ids),
                    FileExtractionModel.user_id == user_id,
                    FileExtractionModel.is_current.is_(True),
                    FileExtractionModel.status == FileKnowledgeArtifactStatus.READY,
                )
                .distinct(),
            ),
        )
        if ready_ids != set(base_ids):
            raise BadDataException("Knowledge bases must contain a ready document before assignment")
    await session.execute(
        delete(AgentKnowledgeBaseAssignmentModel).where(
            AgentKnowledgeBaseAssignmentModel.agent_id == agent_id,
            AgentKnowledgeBaseAssignmentModel.user_id == user_id,
        ),
    )
    session.add_all(
        [
            AgentKnowledgeBaseAssignmentModel(
                user_id=user_id,
                agent_id=agent_id,
                knowledge_base_id=base_id,
                position=position,
            )
            for position, base_id in enumerate(base_ids)
        ],
    )
    await session.commit()
    return KnowledgeBaseAssignmentList(knowledge_base_ids=base_ids)
