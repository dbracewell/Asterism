"""Lifecycle-owned knowledge storage services."""

import base64
from pathlib import Path

from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.service import get_file_store
from asterism.domains.knowledge.models import FileKnowledgeArtifactModel
from asterism.domains.knowledge.schemas import KnowledgeCaptionConfiguration
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.schemas import ImageUrlContent, ImageUrlContentPart, LLMMessage, TextContentPart
from asterism.domains.settings.service import get_model_and_provider

from .caption_download import CaptionModelDownloadService
from .caption_jobs import KnowledgeCaptionJobs
from .captioning import (
    CaptionErrorCode,
    CaptioningConfiguration,
    CaptioningError,
    CaptionMode,
    CaptionRequest,
    CaptionResult,
    LocalSmolVlm2CaptionProvider,
    bounded_caption,
)
from .embedding_download import EmbeddingModelDownloadService
from .embeddings import OnnxClipEmbeddingProvider
from .jobs import KnowledgeIngestionJobs
from .service import get_captioning_configuration
from .vector_store import LanceDbVectorStore

vector_store = LanceDbVectorStore(
    config.knowledge_root / "lancedb",
    dimension=config.knowledge_embedding_dimension,
    max_concurrency=config.max_concurrent_knowledge_vector_operations,
)

knowledge_ingestion_jobs = KnowledgeIngestionJobs(config.max_concurrent_knowledge_ingestions)

local_caption_provider = LocalSmolVlm2CaptionProvider(
    config.local_caption_models_root,
    bundle_sha256=config.local_caption_model_bundle_sha256,
    max_concurrency=config.max_concurrent_local_captions,
)

logger = get_logger("KNOWLEDGE-RUNTIME")


async def _on_embedding_bundle_ready(_: str) -> None:
    """Resume durable pending work only after a verified bundle is promoted."""
    await knowledge_ingestion_jobs.resume_pending()


embedding_model_download = EmbeddingModelDownloadService(
    config.knowledge_models_root,
    artifact_sha256=config.knowledge_embedding_model_sha256,
    artifact_size_bytes=config.knowledge_embedding_model_size_bytes,
    on_bundle_ready=_on_embedding_bundle_ready,
)

embedding_provider = OnnxClipEmbeddingProvider(
    config.knowledge_models_root,
    artifact_sha256=config.knowledge_embedding_model_sha256,
    artifact_size_bytes=config.knowledge_embedding_model_size_bytes,
    dimension=config.knowledge_embedding_dimension,
    max_concurrency=config.max_concurrent_knowledge_embeddings,
    bundle_is_ready=embedding_model_download.is_ready,
)


async def _provider_caption_document(
    configuration: KnowledgeCaptionConfiguration,
    file: UserFileModel,
    image_path: Path,
) -> CaptionResult:
    model = await get_model_and_provider(configuration.provider_model_id)  # pyright: ignore[reportArgumentType]
    if not model.provider.api_key:
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "The selected caption provider has no API key")

    CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=model.id).validate([model])
    client = LLMClient(
        api_key=model.provider.api_key,
        base_url=model.provider.base_url,
        model_name=model.name,
    )
    image_data = base64.b64encode(image_path.read_bytes()).decode("ascii")
    logger.info(f"Captioning document {file.id} with provider {model.provider.name}/{model.name}")
    response = await client.generate(
        messages=[
            LLMMessage(
                role="user",
                content=[
                    TextContentPart(text="Describe this image accurately in a concise retrieval caption."),
                    ImageUrlContentPart(image_url=ImageUrlContent(url=f"data:{file.mime_type};base64,{image_data}")),
                ],
            )
        ]
    )
    if response.exception is not None:
        logger.error(f"ERROR: Captioning document {file.id} {response.exception}")
        raise CaptioningError(
            CaptionErrorCode.PROVIDER_FAILURE, "Caption provider request failed"
        ) from response.exception

    text = response.content
    return CaptionResult(
        text=bounded_caption(text or "", config.max_caption_chars),
        source=CaptionMode.PROVIDER,
        model=f"{model.provider.name}/{model.name}",
    )


async def _caption_file_artifact(artifact: FileKnowledgeArtifactModel, file: UserFileModel) -> CaptionResult:
    """Generate a caption without logging source image bytes or caption text."""
    if file.kind is not FileKind.IMAGE:
        logger.error(f"File artifact {artifact.id} is not an image and cannot be captioned")
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Only image documents can be captioned")

    try:
        image_path = get_file_store().open(artifact.user_id, file.filename)
    except ValueError as error:
        logger.error(f"Image file ({file.id}) is unavailable: {error}")
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image file is unavailable") from error

    if not image_path.is_file() or image_path.stat().st_size > config.max_vision_image_bytes:
        logger.error(f"Image file ({file.id}) is unavailable or exceeds the size limit")
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image file is unavailable or exceeds the size limit")

    async with get_async_db_session() as session:
        configuration = await get_captioning_configuration(session=session)

    if configuration.mode == CaptionMode.DISABLED:
        logger.warning(f"Attempted to caption file artifact {artifact.id} but captioning is disabled")
        raise CaptioningError(CaptionErrorCode.DISABLED, "Image captioning is disabled")

    request = CaptionRequest(
        revision_id=artifact.id,
        image_path=image_path,
        max_image_bytes=config.max_vision_image_bytes,
        max_caption_chars=config.max_caption_chars,
    )

    if configuration.mode == CaptionMode.LOCAL:
        return await local_caption_provider.caption(request)

    if configuration.provider_model_id is None:
        logger.warning(f"Attempted to caption file artifact {artifact.id} but no provider model is selected")
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "No caption provider model is selected")

    return await _provider_caption_document(configuration, file, image_path)


knowledge_caption_jobs = KnowledgeCaptionJobs(
    _caption_file_artifact,
    max_concurrency=config.max_concurrent_local_captions,
)


async def _on_caption_bundle_ready(bundle_sha256: str) -> None:
    """Update the caption provider's bundle SHA-256 after a successful download."""
    local_caption_provider._bundle_sha256 = bundle_sha256.lower()


caption_model_download = CaptionModelDownloadService(
    config.local_caption_models_root,
    on_bundle_ready=_on_caption_bundle_ready,
)


async def initialize_knowledge_runtime() -> None:
    """Create/open LanceDB and make interrupted jobs explicitly retryable."""
    # The download service verifies an existing local bundle during construction.
    # Restore that verified manifest hash into the provider after a process restart;
    # otherwise a valid downloaded bundle would incorrectly look unprovisioned.
    existing_bundle_sha256 = caption_model_download.status().bundle_sha256
    if existing_bundle_sha256 is not None:
        await _on_caption_bundle_ready(existing_bundle_sha256)
    await vector_store.initialize()
    await knowledge_ingestion_jobs.recover_interrupted()
    await knowledge_caption_jobs.recover_interrupted()
    if embedding_model_download.is_ready():
        await knowledge_ingestion_jobs.resume_pending()
    else:
        await embedding_model_download.start_download()


async def shutdown_knowledge_runtime() -> None:
    await embedding_model_download.shutdown()
    await caption_model_download.shutdown()
    await knowledge_caption_jobs.shutdown()
    await knowledge_ingestion_jobs.shutdown()
    await local_caption_provider.close()
    await embedding_provider.close()
    await vector_store.close()
