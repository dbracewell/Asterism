"""Bounded, offline-safe image-captioning contracts and local SmolVLM2 adapter."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import uuid
from pathlib import Path
from typing import Any

from asterism.common.log import get_logger
from asterism.core import config
from asterism.db.database import get_async_db_session
from asterism.domains.extraction.embedding import embedding_provider
from asterism.domains.extraction.models import FileExtractionModel, KnowledgeCaptionMode, KnowledgeCaptionStatus
from asterism.domains.extraction.vector_store import VectorChunk, vector_store
from asterism.domains.files.models import FileKind, UserFileModel
from asterism.domains.files.store import get_file_store
from asterism.domains.knowledge_base.schemas import KnowledgeCaptionConfiguration
from asterism.domains.llm.client import LLMClient
from asterism.domains.llm.schemas import ImageUrlContent, ImageUrlContentPart, LLMMessage, TextContentPart
from asterism.domains.settings.knowledge import get_captioning_configuration
from asterism.domains.settings.service import get_model_and_provider
from PIL import Image
from sqlalchemy import select

from .caption_schemas import (
    CaptionErrorCode,
    CaptioningConfiguration,
    CaptioningError,
    CaptionMode,
    CaptionRequest,
    CaptionResult,
)
from .model_download import ModelDownloadService, PinnedModel, verify_manifest

logger = get_logger("CAPTION_PROCESSING")


def bounded_caption(text: str, limit: int) -> str:
    normalized = " ".join(text.split())
    if not normalized:
        raise CaptioningError(CaptionErrorCode.OUTPUT_INVALID, "Caption provider returned no description")
    if len(normalized) > limit:
        return normalized[:limit].rstrip()
    return normalized


class LocalSmolVlm2CaptionProvider:
    """CPU-only SmolVLM2 adapter that will only load an already-provisioned bundle."""

    def __init__(
        self,
        model_root: Path,
        *,
        pinned_model: PinnedModel,
        max_concurrency: int = 1,
        max_new_tokens: int = 128,
    ) -> None:
        if max_concurrency < 1:
            raise ValueError("max_concurrency must be positive")
        if not 1 <= max_new_tokens <= 512:
            raise ValueError("max_new_tokens must be from 1 to 512")
        self._pinned_model = pinned_model
        self._bundle_sha256: str | None = None
        self._model_root = model_root.resolve()
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._max_new_tokens = max_new_tokens
        self._model: Any | None = None
        self._processor: Any | None = None

    def _initialize_sync(self) -> None:
        if not verify_manifest(self._model_root, self._pinned_model):
            raise CaptioningError(
                CaptionErrorCode.NOT_READY,
                "Local caption model is not provisioned or manifest is invalid",
            )
        try:
            import torch
            from transformers import AutoModelForImageTextToText, AutoProcessor

            self._processor = AutoProcessor.from_pretrained(
                self._model_root,
                local_files_only=True,
                trust_remote_code=False,
            )
            model = AutoModelForImageTextToText.from_pretrained(
                self._model_root,
                local_files_only=True,
                trust_remote_code=False,
                torch_dtype=torch.float32,
            )
            self._model = getattr(model, "to")("cpu").eval()
        except CaptioningError:
            raise
        except Exception as error:
            self._model = None
            self._processor = None
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model could not be initialized") from error

    async def initialize(self) -> None:
        if self._model is None or self._processor is None:
            await asyncio.to_thread(self._initialize_sync)

    def _caption_sync(self, request: CaptionRequest) -> str:
        if self._model is None or self._processor is None:
            raise CaptioningError(CaptionErrorCode.NOT_READY, "Local caption model is not initialized")
        try:
            if not request.image_path.is_file() or request.image_path.stat().st_size > request.max_image_bytes:
                raise CaptioningError(
                    CaptionErrorCode.IMAGE_INVALID,
                    "Image is unavailable or exceeds the captioning limit",
                )
            with Image.open(request.image_path) as image:
                image.verify()
            with Image.open(request.image_path) as image:
                rgb_image = image.convert("RGB")
                messages = [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image"},
                            {"type": "text", "text": "Describe this image concisely."},
                        ],
                    },
                ]
                prompt = self._processor.apply_chat_template(messages, add_generation_prompt=True)
                inputs = self._processor(text=prompt, images=[rgb_image], return_tensors="pt")
                generated = self._model.generate(**inputs, max_new_tokens=self._max_new_tokens, do_sample=False)
                prompt_tokens = inputs["input_ids"].shape[1]
                return self._processor.decode(generated[0][prompt_tokens:], skip_special_tokens=True)
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
        self._model = None
        self._processor = None


caption_model = PinnedModel(
    id="HuggingFaceTB/SmolVLM2-256M-Video-Instruct",
    revision="067788b187b95ebe7b2e040b3e4299e342e5b8fd",
    size_bytes=515_000_000,
    allow_patterns=[
        "*.json",
        "*.safetensors",
        "merges.txt",
        "vocab.json",
    ],
    ignore_patterns=[
        "onnx/*",
        "README.md",
        ".gitattributes",
    ],
)

local_caption_provider = LocalSmolVlm2CaptionProvider(
    model_root=config.local_caption_models_root,
    pinned_model=caption_model,
    max_concurrency=1,
    max_new_tokens=128,
)


async def _on_caption_bundle_ready(bundle_sha256: str) -> None:
    """Update the caption provider's bundle SHA-256 after a successful download."""
    local_caption_provider._bundle_sha256 = bundle_sha256.lower()


captioning_download_service = ModelDownloadService(
    model_root=config.local_caption_models_root,
    pinned_model=caption_model,
    on_bundle_ready=_on_caption_bundle_ready,
)


async def _provider_model_caption(
    request: CaptionRequest,
    configuration: KnowledgeCaptionConfiguration,
) -> CaptionResult:
    model = await get_model_and_provider(configuration.provider_model_id)
    if not model.provider.api_key:
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "The selected caption provider has no API key")

    CaptioningConfiguration(mode=CaptionMode.PROVIDER, provider_model_id=model.id).validate([model])
    client = LLMClient(
        api_key=model.provider.api_key,
        base_url=model.provider.base_url,
        model_name=model.name,
    )
    image_data = base64.b64encode(request.image_path.read_bytes()).decode("ascii")
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
                select(FileExtractionModel).where(
                    FileExtractionModel.id == artifact_id,
                    FileExtractionModel.user_id == user_id,
                    FileExtractionModel.file_id == file_id,
                ),
            )
            file = await session.scalar(
                select(UserFileModel).where(
                    UserFileModel.id == file_id,
                    UserFileModel.user_id == user_id,
                ),
            )

            if artifact is None or file is None:
                return

            if artifact.caption_status not in {KnowledgeCaptionStatus.PENDING, KnowledgeCaptionStatus.FAILED}:
                return
            artifact.caption_status = KnowledgeCaptionStatus.RUNNING
            await session.commit()
            try:
                result = await asyncio.wait_for(
                    _caption(artifact=artifact, file=file),
                    timeout=config.file_conversion_timeout_s,
                )
                vector = (await embedding_provider.embed_text([result.text]))[0]
                chunk_id = hashlib.sha256(f"{file.id}:{artifact.generation}:caption".encode()).hexdigest()
                await vector_store.delete_chunk(user_id=user_id, chunk_id=chunk_id)
                await vector_store.add(
                    [
                        VectorChunk(
                            chunk_id,
                            user_id,
                            str(file.id),
                            artifact.generation,
                            artifact.chunk_count,
                            result.text,
                            vector,
                        ),
                    ],
                )
                artifact.caption_text = result.text
                artifact.caption_source = KnowledgeCaptionMode(result.source.value)
                artifact.caption_model = result.model
                artifact.caption_status = KnowledgeCaptionStatus.DRAFT
                artifact.caption_error_code = None
                artifact.caption_error_reason = None
            except Exception as error:
                artifact.caption_status = KnowledgeCaptionStatus.FAILED
                artifact.caption_error_code = (
                    error.code.value
                    if isinstance(error, CaptioningError)
                    else "timeout"
                    if isinstance(error, TimeoutError)
                    else "provider_failure"
                )
                artifact.caption_error_reason = (
                    str(error) if isinstance(error, CaptioningError) else "Image captioning failed; check server logs"
                )
                logger.exception("Image captioning failed")
            await session.commit()
    except Exception:
        logger.exception("Could not persist image caption work")
        return


async def _caption(artifact: FileExtractionModel, file: UserFileModel) -> CaptionResult:
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
        file=file,
        image_path=image_path,
        max_image_bytes=config.max_vision_image_bytes,
        max_caption_chars=config.max_caption_chars,
    )

    if configuration.mode == CaptionMode.LOCAL:
        return await local_caption_provider.caption(request)

    if configuration.provider_model_id is None:
        logger.warning(f"Attempted to caption file artifact {artifact.id} but no provider model is selected")
        raise CaptioningError(CaptionErrorCode.INVALID_SELECTION, "No caption provider model is selected")

    return await _provider_model_caption(request, configuration)
