"""Processing-policy transitions and knowledge-artifact generations.

The policy's *state* lives in :mod:`asterism.domains.knowledge.policy`; this
module owns the *transition* — applying a new policy, creating the replacement
artifact generations, and scheduling the durable reprocessing jobs.

The reprocessing set is derived from this domain's own artifact table. Every
uploaded source file receives a knowledge artifact in the same transaction that
creates the file, and artifacts are removed with their file, so the files that
own an artifact are exactly the files that can be reprocessed. Deriving the
set here keeps the domain from importing the files domain.
"""

import asyncio
import shutil
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core import config
from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.knowledge.caption_schemas import CaptioningConfiguration, CaptioningError, CaptionMode
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from asterism.domains.knowledge.runtime import start_file_ingestion_job
from asterism.domains.settings.models import LLMModel
from asterism.domains.settings.queries import is_global_model

from .embedding import EMBEDDING_MODEL_KEY
from .policy import (
    load_processing_configuration,
    processing_identity,
    profile_from_configuration,
    save_processing_configuration,
)
from .processing_schemas import (
    KnowledgeCaptionConfiguration,
    KnowledgeCaptionConfigurationUpdate,
    KnowledgeProcessingCaptioningConfiguration,
    KnowledgeProcessingConfiguration,
    KnowledgeProcessingProfileUpdate,
    KnowledgeReprocessSummary,
)

logger = get_logger("KnowledgeProcessing")


@dataclass(frozen=True)
class ReprocessTarget:
    """One source file that needs a replacement knowledge artifact.

    Attributes:
        file_id: The source file that owns the artifact.
        user_id: The file's owner; every artifact read is owner-scoped.
    """

    file_id: uuid.UUID
    user_id: str


async def select_reprocess_targets(*, session: AsyncSession) -> Sequence[ReprocessTarget]:
    """Return every source file that currently owns a knowledge artifact.

    Args:
        session: Active async session.

    Returns:
        One target per source file that owns at least one artifact generation.
    """
    rows = await session.execute(
        select(FileKnowledgeArtifactModel.file_id, FileKnowledgeArtifactModel.user_id).distinct(),
    )
    return [ReprocessTarget(file_id=file_id, user_id=user_id) for file_id, user_id in rows.all()]


async def ensure_file_knowledge_artifact(
    *,
    file_id: uuid.UUID,
    user_id: str,
    session: AsyncSession,
) -> FileKnowledgeArtifactModel:
    """Create the one pending canonical artifact for a newly eligible file.

    A pending replacement is deliberately *not* current: retrieval can retain
    an older ready generation until processing succeeds.

    Args:
        file_id: The file that should have a knowledge artifact.
        user_id: The file's owner.
        session: Active async session; the new row is added but not committed.

    Returns:
        The existing artifact for the current policy generation, or a newly
        added pending artifact with the next generation number.
    """
    _, configuration = await load_processing_configuration(session=session)
    existing = await session.scalar(
        select(FileKnowledgeArtifactModel).where(
            FileKnowledgeArtifactModel.file_id == file_id,
            FileKnowledgeArtifactModel.processing_profile_generation == configuration.generation,
        ),
    )
    if existing is not None:
        return existing
    generation = (
        await session.scalar(
            select(func.max(FileKnowledgeArtifactModel.generation)).where(
                FileKnowledgeArtifactModel.file_id == file_id,
            ),
        )
        or 0
    ) + 1
    artifact = FileKnowledgeArtifactModel(
        id=uuid.uuid4(),
        user_id=user_id,
        file_id=file_id,
        generation=generation,
        processing_profile_generation=configuration.generation,
        status=KnowledgeExtractionStatus.PENDING,
        is_current=False,
    )
    session.add(artifact)
    # The text extraction and the embedding are derived from every source
    # file, so both start pending with the artifact. The caption only applies
    # to images, so its row is created when the ingestion knows the kind.
    for kind in (KnowledgeExtractionKind.TEXT_EXTRACTION, KnowledgeExtractionKind.EMBEDDING):
        session.add(
            FileKnowledgeExtractionModel(
                artifact_id=artifact.id,
                kind=kind,
                status=KnowledgeExtractionStatus.PENDING,
            )
        )
    return artifact


def _with_resolved_identity(configuration: KnowledgeProcessingConfiguration) -> KnowledgeProcessingConfiguration:
    """Return a policy whose identity covers every processing-relevant input.

    Args:
        configuration: The policy to fingerprint.

    Returns:
        A copy of *configuration* whose ``identity`` is recomputed from its
        extraction, chunking, embedding and captioning inputs.
    """
    identity = processing_identity(
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

    Args:
        candidate: The desired policy. Its identity is recomputed here.
        session: Active async session; the transaction is committed here.

    Returns:
        A summary of the new profile and how many files were queued for
        reprocessing.
    """
    setting, current = await load_processing_configuration(session=session)
    candidate = _with_resolved_identity(candidate)
    if candidate.identity == current.identity:
        # An explicit write of the default policy heals the previously missing
        # setting without creating needless artifact generations.
        if setting is None:
            setting = save_processing_configuration(setting=None, configuration=candidate, session=session)
            await session.commit()
        return KnowledgeReprocessSummary(
            profile=profile_from_configuration(current, updated_at=setting.updated_at if setting else 0),
            queued_file_count=0,
        )
    candidate = candidate.model_copy(update={"generation": current.generation + 1})
    setting = save_processing_configuration(setting=setting, configuration=candidate, session=session)
    targets = await select_reprocess_targets(session=session)
    replacements = [
        await ensure_file_knowledge_artifact(file_id=target.file_id, user_id=target.user_id, session=session)
        for target in targets
    ]
    await session.commit()

    for target, artifact in zip(targets, replacements, strict=True):
        start_file_ingestion_job(user_id=target.user_id, file_id=target.file_id, artifact_id=artifact.id)
    return KnowledgeReprocessSummary(
        profile=profile_from_configuration(candidate, updated_at=setting.updated_at),
        queued_file_count=len(replacements),
    )


async def update_processing_profile_and_reprocess(
    *,
    payload: KnowledgeProcessingProfileUpdate,
    session: AsyncSession,
) -> KnowledgeReprocessSummary:
    """Apply a processing-policy edit through the one transition path.

    Args:
        payload: The new policy identifiers.
        session: Active async session; the transaction is committed here.

    Returns:
        A summary of the new profile and how many files were queued for
        reprocessing.

    Raises:
        BadDataException: If the stored setting cannot be loaded or persisted.
    """
    if payload.embedding_model != EMBEDDING_MODEL_KEY:
        # The code's model is the only one that can embed (ADR-0079).
        raise BadDataException(f"The embedding model is {EMBEDDING_MODEL_KEY}")
    _, current = await load_processing_configuration(session=session)
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


async def reembed_for_current_model(*, session: AsyncSession) -> KnowledgeReprocessSummary | None:
    """Start a new generation when the stored files were embedded by another model.

    Runs on every start. After an upgrade that changes the embedding model
    (ADR-0079), every file is queued again under the new model; images reuse
    their captions. Nothing happens when the model is unchanged.
    """
    _, current = await load_processing_configuration(session=session)
    if current.embedding_model == EMBEDDING_MODEL_KEY:
        return None
    return await _transition_processing_configuration(
        candidate=current.model_copy(update={"embedding_model": EMBEDDING_MODEL_KEY}),
        session=session,
    )


async def retire_previous_embedding_model() -> None:
    """On start, after a change of embedding model, re-embed every file (ADR-0079).

    The previous model's bundle is deleted, and its vector table was dropped
    when the store opened. Files are queued as a new processing generation and
    processed once the new bundle is ready.
    """
    legacy = config.legacy_knowledge_models_root
    if legacy.exists():
        await asyncio.to_thread(shutil.rmtree, legacy, True)
        logger.info("Removed the previous knowledge embedding model bundle")
    async with get_async_db_session() as session:
        summary = await reembed_for_current_model(session=session)
    if summary is not None:
        logger.info(f"The embedding model changed; {summary.queued_file_count} files will be embedded again")


async def update_captioning_configuration(
    *,
    payload: KnowledgeCaptionConfigurationUpdate,
    session: AsyncSession,
) -> KnowledgeCaptionConfiguration:
    """Apply a captioning edit through the processing-policy transition path.

    Args:
        payload: The requested captioning mode and provider model.
        session: Active async session; the transaction is committed here.

    Returns:
        The active captioning configuration with its last-update timestamp.

    Raises:
        BadDataException: If the requested mode/model combination is not
            eligible, or the policy cannot be persisted.
    """
    models = list(await session.scalars(select(LLMModel).where(is_global_model())))
    try:
        selected = CaptioningConfiguration(
            mode=CaptionMode(payload.mode),
            provider_model_id=payload.provider_model_id,
        )
        selected.validate(models)  # pyright: ignore[reportArgumentType]
    except CaptioningError as error:
        raise BadDataException(str(error)) from error

    _, configuration = await load_processing_configuration(session=session)
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
