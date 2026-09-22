"""Lifecycle-owned knowledge storage services."""

import base64

from openai import AsyncOpenAI

from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.files.models import FileKind
from asterism.domains.files.service import get_file_store
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
embedding_provider = OnnxClipEmbeddingProvider(
    config.knowledge_models_root,
    artifact_sha256=config.knowledge_embedding_model_sha256,
    artifact_size_bytes=config.knowledge_embedding_model_size_bytes,
    dimension=config.knowledge_embedding_dimension,
    max_concurrency=config.max_concurrent_knowledge_embeddings,
)
local_caption_provider = LocalSmolVlm2CaptionProvider(
    config.local_caption_models_root,
    bundle_sha256=config.local_caption_model_bundle_sha256,
    max_concurrency=config.max_concurrent_local_captions,
)


async def _caption_document(document, file) -> CaptionResult:
    """Generate a caption without logging source image bytes or caption text."""
    if file.kind is not FileKind.IMAGE:
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Only image documents can be captioned")
    try:
        image_path = get_file_store().open(document.user_id, file.filename)
    except ValueError as error:
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image file is unavailable") from error
    if not image_path.is_file() or image_path.stat().st_size > config.max_vision_image_bytes:
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image file is unavailable or exceeds the size limit")

    async with get_async_db_session() as session:
        configuration = await get_captioning_configuration(session=session)
    if configuration.mode == CaptionMode.DISABLED:
        raise CaptioningError(CaptionErrorCode.DISABLED, "Image captioning is disabled")

    request = CaptionRequest(
        revision_id=document.id,
        image_path=image_path,
        max_image_bytes=config.max_vision_image_bytes,
        max_caption_chars=config.max_caption_chars,
    )
    if configuration.mode == CaptionMode.LOCAL:
        return await local_caption_provider.caption(request)
    if configuration.provider_model_id is None:
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "No caption provider model is selected")

    model = await get_model_and_provider(configuration.provider_model_id)
    try:
        CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=model.id).validate([model])
        image_data = base64.b64encode(image_path.read_bytes()).decode("ascii")
        client = AsyncOpenAI(api_key=model.provider.api_key, base_url=model.provider.base_url, timeout=60.0)
        try:
            response = await client.chat.completions.create(
                model=model.name,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Describe this image accurately in a concise retrieval caption."},
                            {"type": "image_url", "image_url": {"url": f"data:{file.mime_type};base64,{image_data}"}},
                        ],
                    }
                ],
                max_tokens=256,
            )
        finally:
            await client.close()
    except CaptioningError:
        raise
    except Exception as error:
        raise CaptioningError(CaptionErrorCode.PROVIDER_FAILURE, "Caption provider request failed") from error
    text = response.choices[0].message.content if response.choices else None
    return CaptionResult(
        text=bounded_caption(text or "", config.max_caption_chars),
        source=CaptionMode.PROVIDER,
        model=f"{model.provider.name}/{model.name}",
    )


knowledge_caption_jobs = KnowledgeCaptionJobs(
    _caption_document,
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


async def shutdown_knowledge_runtime() -> None:
    await caption_model_download.shutdown()
    await knowledge_caption_jobs.shutdown()
    await knowledge_ingestion_jobs.shutdown()
    await local_caption_provider.close()
    await embedding_provider.close()
    await vector_store.close()
