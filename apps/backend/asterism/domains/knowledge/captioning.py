"""Bounded, offline-safe image captioning: provider models and local SmolVLM2 on ONNX Runtime."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import time
import uuid
from pathlib import Path

from sqlalchemy import select

from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.knowledge.embedding import embedding_provider
from asterism.domains.knowledge.models import (
    FileKnowledgeArtifactModel,
    FileKnowledgeExtractionModel,
    KnowledgeExtractionKind,
    KnowledgeExtractionStatus,
)
from asterism.domains.knowledge.policy import get_captioning_configuration
from asterism.domains.knowledge.processing_schemas import KnowledgeCaptionConfiguration
from asterism.domains.knowledge.vector_store import VectorChunk, vector_store
from asterism.domains.llm.factory import create_llm_client
from asterism.domains.llm.metering import meter_for
from asterism.domains.llm.schemas import ImageUrlContent, ImageUrlContentPart, LLMMessage, TextContentPart
from asterism.domains.settings.service import get_model_and_provider
from asterism.domains.usage.schemas import UsageSource

from .caption_schemas import (
    CaptionErrorCode,
    CaptioningConfiguration,
    CaptioningError,
    CaptionMode,
    CaptionRequest,
    CaptionResult,
)
from .model_download import ModelDownloadService, PinnedModel, verify_manifest
from .onnx_captioning import SmolVlm2OnnxCaptioner, SmolVlm2OnnxFiles
from .sources import SourceContent, SourceUnavailableError, get_source_reader

logger = get_logger("CAPTION_PROCESSING")


def bounded_caption(text: str, limit: int) -> str:
    normalized = " ".join(text.split())
    if not normalized:
        raise CaptioningError(CaptionErrorCode.OUTPUT_INVALID, "Caption provider returned no description")
    if len(normalized) > limit:
        return normalized[:limit].rstrip()
    return normalized


class OnnxSmolVlm2CaptionProvider:
    """CPU SmolVLM2 on ONNX Runtime that only loads a verified, already-provisioned bundle."""

    def __init__(
        self,
        model_root: Path,
        *,
        pinned_model: PinnedModel,
        files: SmolVlm2OnnxFiles,
        max_concurrency: int = 1,
        max_new_tokens: int = 128,
        timeout_s: float = 120,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be positive")
        if not 1 <= max_new_tokens <= 512:
            raise ValueError("max_new_tokens must be from 1 to 512")
        if timeout_s <= 0:
            raise ValueError("timeout_s must be positive")
        self._pinned_model = pinned_model
        self._files = files
        self._model_root = model_root.resolve()
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._max_new_tokens = max_new_tokens
        self._timeout_s = timeout_s
        self._captioner: SmolVlm2OnnxCaptioner | None = None

    def _initialize_sync(self) -> None:
        if not verify_manifest(self._model_root, self._pinned_model):
            raise CaptioningError(
                CaptionErrorCode.NOT_READY,
                "Local caption model is not provisioned or manifest is invalid",
            )
        try:
            self._captioner = SmolVlm2OnnxCaptioner(self._model_root, self._files)
        except Exception as error:
            self._captioner = None
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model could not be initialized") from error

    async def initialize(self) -> None:
        if self._captioner is None:
            async with self._semaphore:
                if self._captioner is None:
                    await asyncio.to_thread(self._initialize_sync)

    def _caption_sync(self, request: CaptionRequest) -> str:
        if self._captioner is None:
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model is not initialized")
        if len(request.image) > request.max_image_bytes:
            raise CaptioningError(
                CaptionErrorCode.IMAGE_INVALID,
                "Image is unavailable or exceeds the captioning limit",
            )
        try:
            return self._captioner.caption(
                request.image,
                max_new_tokens=self._max_new_tokens,
                deadline=time.monotonic() + self._timeout_s,
            )
        except CaptioningError:
            raise
        except Exception as error:
            raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image could not be captioned locally") from error

    async def caption(self, request: CaptionRequest) -> CaptionResult:
        await self.initialize()
        async with self._semaphore:
            text = await asyncio.to_thread(self._caption_sync, request)
        return CaptionResult(
            text=bounded_caption(text, request.max_caption_chars),
            source=CaptionMode.LOCAL,
            model="SmolVLM2",
        )

    async def close(self) -> None:
        self._captioner = None


# ADR-0077: the int8 export of the same revision captions accurately, at a
# quarter of the download. Every file is pinned by SHA-256.
CAPTION_MODEL_PRECISION = "int8"
caption_model_files = SmolVlm2OnnxFiles(
    vision_encoder=f"onnx/vision_encoder_{CAPTION_MODEL_PRECISION}.onnx",
    embed_tokens=f"onnx/embed_tokens_{CAPTION_MODEL_PRECISION}.onnx",
    decoder=f"onnx/decoder_model_merged_{CAPTION_MODEL_PRECISION}.onnx",
)
caption_model = PinnedModel(
    id="HuggingFaceTB/SmolVLM2-256M-Video-Instruct",
    revision="067788b187b95ebe7b2e040b3e4299e342e5b8fd",
    size_bytes=265_041_118,
    allow_patterns=[],
    files={
        "added_tokens.json": "74135b8664b56088c0006f1c8e848d79a8eba003411f72ebf1dc2ee96227be3a",
        "config.json": "756cb7d37d7659c9d5a71c563f9d2530f9dd674ab7e909d8d0dd5b1a2d3e8317",
        "generation_config.json": "34835060c9f0f74d1acb456cc72ca32746d3843d9eb5f578f9cbffac1d2eb840",
        "merges.txt": "0b54e8aa4e53d5383e2e4bc635a56b43f9647f7b13832d5d9ecd8f82dac4f510",
        "preprocessor_config.json": "149e315d9410368e5491455bb06e0f763426e9e56cca731c13b24404a29b6374",
        "processor_config.json": "f3ad45028447b3562b4752be0d5916d6806c1ef589091a469608dcf0faa1737c",
        "special_tokens_map.json": "2dfea2a426162316ff1567c82bc6d36d9690cd9f90455f075c77daca78b45c60",
        "tokenizer.json": "5ece781dc8d2b2f3e2f289ca0ae50b17cfc27dd27bfe7971bb8241e0b964331a",
        "tokenizer_config.json": "dd9ce2ab89a3dd881bd9378f1a79b943a064b9275a7e1706d5b7b47b68977913",
        "vocab.json": "82b84012e3add4d01d12ba14442026e49b8cbbaead1f79ecf3d919784f82dc79",
        caption_model_files.vision_encoder: "39f0efae9614b1679404961efb970bf307adb76b4d9fb4e25f1e3c564611963d",
        caption_model_files.embed_tokens: "e2cdc3690af5719c7463254f96c3b665a9e24add2a1fa6f594347d67a422710a",
        caption_model_files.decoder: "03304ea9501d2d72c3858d668a56f54fc42fc54132759c389e54ff706f3d37c1",
    },
)

local_caption_provider = OnnxSmolVlm2CaptionProvider(
    model_root=config.local_caption_models_root,
    pinned_model=caption_model,
    files=caption_model_files,
    max_concurrency=1,
    max_new_tokens=128,
    timeout_s=config.file_conversion_timeout_s,
)

captioning_download_service = ModelDownloadService(
    model_root=config.local_caption_models_root,
    pinned_model=caption_model,
)


async def _provider_model_caption(
    request: CaptionRequest,
    configuration: KnowledgeCaptionConfiguration,
) -> CaptionResult:
    model = await get_model_and_provider(configuration.provider_model_id)
    if not model.provider.api_key:
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "The selected caption provider has no API key")

    CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=model.id).validate([model])
    # Background work for the file's owner: counted, never refused (ADR-0073).
    client = create_llm_client(
        model.name, model.provider, usage=meter_for(request.file.user_id, UsageSource.CAPTION, model)
    )
    image_data = base64.b64encode(request.image).decode("ascii")
    logger.info(f"Captioning document {request.file.id} with provider {model.provider.name}/{model.name}")
    response = await client.generate(
        messages=[
            LLMMessage(
                role="user",
                content=[
                    TextContentPart(text="Describe this image accurately in a concise retrieval caption."),
                    ImageUrlContentPart(
                        image_url=ImageUrlContent(url=f"data:{request.file.mime_type};base64,{image_data}"),
                    ),
                ],
            ),
        ],
    )
    if response.exception is not None:
        logger.error(f"ERROR: Captioning document {request.file.id} {response.exception}")
        raise CaptioningError(
            CaptionErrorCode.PROVIDER_FAILURE,
            "Caption provider request failed",
        ) from response.exception

    text = response.content
    return CaptionResult(
        text=bounded_caption(text or "", config.max_caption_chars),
        source=CaptionMode.PROVIDER,
        model=f"{model.provider.name}/{model.name}",
    )


async def caption(
    user_id: str,
    file_id: uuid.UUID,
    artifact_id: uuid.UUID,
):
    try:
        async with get_async_db_session() as session:
            artifact = await session.scalar(
                select(FileKnowledgeArtifactModel).where(
                    FileKnowledgeArtifactModel.id == artifact_id,
                    FileKnowledgeArtifactModel.user_id == user_id,
                    FileKnowledgeArtifactModel.file_id == file_id,
                ),
            )

            if artifact is None:
                return

            captioning = await session.scalar(
                select(FileKnowledgeExtractionModel).where(
                    FileKnowledgeExtractionModel.artifact_id == artifact.id,
                    FileKnowledgeExtractionModel.kind == KnowledgeExtractionKind.CAPTIONING,
                ),
            )
            if captioning is None:
                return
            if captioning.status not in {KnowledgeExtractionStatus.PENDING, KnowledgeExtractionStatus.FAILED}:
                return
            configuration = await get_captioning_configuration(session=session)
            if configuration.mode == CaptionMode.LOCAL and not await asyncio.to_thread(
                captioning_download_service.is_ready,
            ):
                # Stays pending: the startup resume and the bundle-ready callback requeue it.
                logger.info(f"Local caption model is not ready; captioning of {artifact.id} waits for it")
                return
            captioning.status = KnowledgeExtractionStatus.RUNNING
            captioning.started_at = get_unix_timestamp()
            await session.commit()
            try:
                try:
                    source = await get_source_reader().read_source(
                        file_id=file_id,
                        user_id=user_id,
                        session=session,
                    )
                except SourceUnavailableError as error:
                    # The image cannot be read, so it cannot be captioned.
                    raise CaptioningError(
                        CaptionErrorCode.IMAGE_INVALID,
                        "Image file is unavailable",
                    ) from error
                result = await asyncio.wait_for(
                    _caption(artifact=artifact, source=source),
                    timeout=config.file_conversion_timeout_s,
                )
                vector = (await embedding_provider.embed_text([result.text]))[0]
                chunk_id = hashlib.sha256(f"{file_id}:{artifact.generation}:caption".encode()).hexdigest()
                await vector_store.delete_chunk(user_id=user_id, chunk_id=chunk_id)
                await vector_store.add(
                    [
                        VectorChunk(
                            chunk_id,
                            user_id,
                            str(file_id),
                            artifact.generation,
                            artifact.chunk_count,
                            "caption",
                            result.text,
                            vector,
                        ),
                    ],
                )
                captioning.status = KnowledgeExtractionStatus.READY
                captioning.provider = result.source.value
                captioning.model = result.model
                captioning.payload = {"text": result.text}
                captioning.error_code = None
                captioning.error_reason = None
                captioning.completed_at = get_unix_timestamp()
                # A caption makes the generation searchable, which is the
                # denormalized aggregate the retrieval path reads.
                artifact.searchable = True
            except Exception as error:
                captioning.status = KnowledgeExtractionStatus.FAILED
                captioning.error_code = (
                    error.code.value
                    if isinstance(error, CaptioningError)
                    else "timeout"
                    if isinstance(error, TimeoutError)
                    else "provider_failure"
                )
                captioning.error_reason = (
                    str(error) if isinstance(error, CaptioningError) else "Image captioning failed; check server logs"
                )
                captioning.completed_at = get_unix_timestamp()
                logger.exception("Image captioning failed")
            await session.commit()
    except Exception:
        logger.exception("Could not persist image caption work")
        return


async def _caption(artifact: FileKnowledgeArtifactModel, source: SourceContent) -> CaptionResult:
    if not source.file.is_image:
        logger.error(f"File artifact {artifact.id} is not an image and cannot be captioned")
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Only image documents can be captioned")

    image = source.image
    if image is None or len(image) > config.max_vision_image_bytes:
        logger.error(f"Image file ({source.file.id}) is unavailable or exceeds the size limit")
        raise CaptioningError(CaptionErrorCode.IMAGE_INVALID, "Image file is unavailable or exceeds the size limit")

    async with get_async_db_session() as session:
        configuration = await get_captioning_configuration(session=session)

    if configuration.mode == CaptionMode.DISABLED:
        logger.warning(f"Attempted to caption file artifact {artifact.id} but captioning is disabled")
        raise CaptioningError(CaptionErrorCode.DISABLED, "Image captioning is disabled")

    request = CaptionRequest(
        revision_id=artifact.id,
        file=source.file,
        image=image,
        max_image_bytes=config.max_vision_image_bytes,
        max_caption_chars=config.max_caption_chars,
    )

    if configuration.mode == CaptionMode.LOCAL:
        return await local_caption_provider.caption(request)

    if configuration.provider_model_id is None:
        logger.warning(f"Attempted to caption file artifact {artifact.id} but no provider model is selected")
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "No caption provider model is selected")

    return await _provider_model_caption(request, configuration)
