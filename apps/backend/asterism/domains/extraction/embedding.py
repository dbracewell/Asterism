"""Local, pinned multimodal embedding providers without model remote code."""

import asyncio
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol

import numpy as np
import onnxruntime as ort
from asterism.core import config
from model_download import (
    ModelDownloadService,
    PinnedModel,
    verify_manifest,
)
from PIL import Image
from transformers import CLIPImageProcessorPil, CLIPTokenizerFast  # pyright: ignore[reportAttributeAccessIssue]


class EmbeddingProviderError(RuntimeError):
    pass


class EmbeddingProvider(Protocol):
    @property
    def dimension(self) -> int: ...
    async def initialize(self) -> None: ...
    async def embed_text(self, texts: Sequence[str]) -> list[list[float]]: ...
    async def embed_image(self, images: Sequence[Path]) -> list[list[float]]: ...
    async def close(self) -> None: ...


class OnnxClipEmbeddingProvider:
    """CPU-only CLIP provider for the pinned Xenova quantized ONNX artifact."""

    def __init__(
        self,
        model_root: Path,
        *,
        pinned_model: PinnedModel,
        dimension: int = 512,
        max_concurrency: int = 2,
        bundle_is_ready: Callable[[], bool] | None = None,
    ) -> None:
        self._model_root = model_root.resolve()
        self._pinned_model = pinned_model
        self._dimension = dimension
        self._bundle_is_ready = bundle_is_ready
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._session: ort.InferenceSession | None = None
        self._tokenizer: CLIPTokenizerFast | None = None
        self._image_processor: CLIPImageProcessorPil | None = None

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def artifact_path(self) -> Path:
        if not self._pinned_model.filename:
            raise EmbeddingProviderError("Knowledge embedding artifact is not specified")
        return self._model_root / self._pinned_model.filename

    def _initialize_sync(self) -> None:
        if not verify_manifest(self._model_root, self._pinned_model):
            raise EmbeddingProviderError("Knowledge embedding manifest verification failed")
        try:
            self._tokenizer = CLIPTokenizerFast.from_pretrained(self._model_root, local_files_only=True)
            # Use the PIL-only processor explicitly: torchvision is intentionally not a runtime dependency.
            self._image_processor = CLIPImageProcessorPil.from_pretrained(self._model_root, local_files_only=True)
            self._session = ort.InferenceSession(str(self.artifact_path), providers=["CPUExecutionProvider"])
        except Exception as error:
            self._session = None
            raise EmbeddingProviderError("Knowledge embedding model could not be initialized") from error

    async def initialize(self) -> None:
        if self._session is None:
            await asyncio.to_thread(self._initialize_sync)

    def _require_ready(self) -> tuple[ort.InferenceSession, CLIPTokenizerFast, CLIPImageProcessorPil]:
        if self._session is None or self._tokenizer is None or self._image_processor is None:
            raise EmbeddingProviderError("Knowledge embedding model is not initialized")

        return self._session, self._tokenizer, self._image_processor

    def _run(
        self,
        output_name: str,
        inputs: dict[str, np.ndarray],
    ) -> list[list[float]]:
        session, _, _ = self._require_ready()
        supplied = {item.name: inputs[item.name] for item in session.get_inputs() if item.name in inputs}

        try:
            vectors = np.asarray(session.run([output_name], supplied)[0])
        except Exception as error:
            raise EmbeddingProviderError("Knowledge embedding inference failed") from error

        if vectors.ndim != 2 or vectors.shape[1] != self.dimension:
            raise EmbeddingProviderError("Knowledge embedding model returned an unexpected vector shape")

        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise EmbeddingProviderError("Knowledge embedding model returned a zero vector")

        return (vectors / norms).astype(np.float32).tolist()

    async def embed_text(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []

        if any(not text.strip() for text in texts):
            raise ValueError("Text embeddings require non-empty text")

        await self.initialize()
        _, tokenizer, processor = self._require_ready()

        def prepare() -> dict[str, np.ndarray]:
            tokens = tokenizer(
                list(texts),
                padding=True,
                truncation=True,
                return_tensors="np",
            )
            blank = Image.new("RGB", (224, 224), "black")
            pixels = processor(images=[blank] * len(texts), return_tensors="np")
            return {
                **{key: np.asarray(value) for key, value in tokens.items()},
                **{key: np.asarray(value) for key, value in pixels.items()},
            }

        async with self._semaphore:
            return await asyncio.to_thread(
                self._run,
                "text_embeds",
                await asyncio.to_thread(prepare),
            )

    async def embed_image(self, images: Sequence[Path]) -> list[list[float]]:
        if not images:
            return []

        await self.initialize()
        _, tokenizer, processor = self._require_ready()

        def prepare() -> dict[str, np.ndarray]:
            try:
                opened: list[Image.Image] = []
                for path in images:
                    with Image.open(path) as image:
                        opened.append(image.convert("RGB"))
                pixels = processor(images=opened, return_tensors="np")
                tokens = tokenizer([""] * len(opened), padding=True, return_tensors="np")
                return {
                    **{key: np.asarray(value) for key, value in tokens.items()},
                    **{key: np.asarray(value) for key, value in pixels.items()},
                }
            except Exception as error:
                raise EmbeddingProviderError("Knowledge image could not be processed") from error

        async with self._semaphore:
            return await asyncio.to_thread(
                self._run,
                "image_embeds",
                await asyncio.to_thread(prepare),
            )

    async def close(self) -> None:
        self._session = None
        self._tokenizer = None
        self._image_processor = None


embedding_model = PinnedModel(
    id="Xenova/clip-vit-base-patch32",
    revision="dcb5f6119fdbb94f1053e98bd74da0ac582ed2a7",
    sha256="90d3b30b11fc99c781a147df7cb3b8dff38b02b2d838b3b28392e7dfb34920b9",
    size_bytes=152_998_734,
    source_filename="onnx/model_quantized.onnx",
    filename="model.onnx",
    allow_patterns=[
        "config.json",
        "preprocessor_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "vocab.json",
        "merges.txt",
        "model.onnx",
    ],
)


embedding_download_service = ModelDownloadService(
    model_root=config.knowledge_models_root,
    pinned_model=embedding_model,
)


embedding_provider = OnnxClipEmbeddingProvider(
    config.knowledge_models_root,
    pinned_model=embedding_model,
    dimension=config.embedding_dimension,
    max_concurrency=config.max_concurrent_knowledge_embeddings,
    bundle_is_ready=embedding_download_service.is_ready,
)
