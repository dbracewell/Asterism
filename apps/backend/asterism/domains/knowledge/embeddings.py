"""Local, pinned multimodal embedding providers without model remote code."""

import asyncio
import hashlib
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import numpy as np
import onnxruntime as ort
from PIL import Image
from transformers import CLIPImageProcessor, CLIPTokenizerFast  # pyright: ignore[reportAttributeAccessIssue]


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

    MODEL_FILENAME = "model.onnx"

    def __init__(
        self,
        model_root: Path,
        *,
        artifact_sha256: str,
        artifact_size_bytes: int,
        dimension: int = 512,
        max_concurrency: int = 2,
    ) -> None:
        self._model_root = model_root.resolve()
        self._artifact_sha256 = artifact_sha256.lower()
        self._artifact_size_bytes = artifact_size_bytes
        self._dimension = dimension
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._session: ort.InferenceSession | None = None
        self._tokenizer: CLIPTokenizerFast | None = None
        self._image_processor: CLIPImageProcessor | None = None

    @property
    def dimension(self) -> int:
        return self._dimension

    @property
    def artifact_path(self) -> Path:
        return self._model_root / self.MODEL_FILENAME

    def _verify_artifact(self) -> None:
        path = self.artifact_path
        if not path.is_file():
            raise EmbeddingProviderError(f"Knowledge embedding artifact is missing: {path}")
        if path.stat().st_size != self._artifact_size_bytes:
            raise EmbeddingProviderError("Knowledge embedding artifact has an unexpected size")
        digest = hashlib.sha256()
        with path.open("rb") as artifact:
            for block in iter(lambda: artifact.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != self._artifact_sha256:
            raise EmbeddingProviderError("Knowledge embedding artifact checksum verification failed")

    def _initialize_sync(self) -> None:
        self._verify_artifact()
        try:
            self._tokenizer = CLIPTokenizerFast.from_pretrained(self._model_root, local_files_only=True)
            # Explicit avoids making torchvision a runtime requirement.
            self._image_processor = CLIPImageProcessor.from_pretrained(self._model_root, local_files_only=True)
            self._session = ort.InferenceSession(str(self.artifact_path), providers=["CPUExecutionProvider"])
        except Exception as error:
            self._session = None
            raise EmbeddingProviderError("Knowledge embedding model could not be initialized") from error

    async def initialize(self) -> None:
        if self._session is None:
            await asyncio.to_thread(self._initialize_sync)

    def _require_ready(self) -> tuple[ort.InferenceSession, CLIPTokenizerFast, CLIPImageProcessor]:
        if self._session is None or self._tokenizer is None or self._image_processor is None:
            raise EmbeddingProviderError("Knowledge embedding model is not initialized")
        return self._session, self._tokenizer, self._image_processor

    def _run(self, output_name: str, inputs: dict[str, np.ndarray]) -> list[list[float]]:
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
            tokens = tokenizer(list(texts), padding=True, truncation=True, return_tensors="np")
            blank = Image.new("RGB", (224, 224), "black")
            pixels = processor(images=[blank] * len(texts), return_tensors="np")
            return {
                **{key: np.asarray(value) for key, value in tokens.items()},
                **{key: np.asarray(value) for key, value in pixels.items()},
            }

        async with self._semaphore:
            return await asyncio.to_thread(self._run, "text_embeds", await asyncio.to_thread(prepare))

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
            return await asyncio.to_thread(self._run, "image_embeds", await asyncio.to_thread(prepare))

    async def close(self) -> None:
        self._session = None
        self._tokenizer = None
        self._image_processor = None
