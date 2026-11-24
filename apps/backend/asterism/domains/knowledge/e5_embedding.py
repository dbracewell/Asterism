"""Multilingual text embeddings with a pinned multilingual-e5-small ONNX bundle (EPIC-99).

The model reads up to 512 tokens and expects a role prefix on every input:
``"query: "`` for what is searched for, ``"passage: "`` for what is searched
(file chunks, captions, memories). Vectors are the attention-masked mean of
``last_hidden_state``, L2-normalised, so a dot product is a cosine similarity.

It runs on ONNX Runtime with the ``tokenizers`` library: no PyTorch and no
model remote code. Images are not embedded; an image is found by its caption.
"""

import asyncio
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Literal

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from .model_download import PinnedModel, verify_manifest

E5_MODEL_FILE = "onnx/model_quantized.onnx"
E5_DIMENSION = 384
E5_MAX_TOKENS = 512

e5_model = PinnedModel(
    id="Xenova/multilingual-e5-small",
    revision="761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    size_bytes=118_308_185 + 17_082_730 + 658 + 443 + 167,
    allow_patterns=[],
    files={
        "config.json": "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
        "tokenizer.json": "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
        "tokenizer_config.json": "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
        "special_tokens_map.json": "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
        E5_MODEL_FILE: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
    },
)

Role = Literal["query", "passage"]


class E5EmbeddingError(RuntimeError):
    pass


class OnnxE5EmbeddingProvider:
    """CPU-only text embeddings from the pinned multilingual-e5-small bundle."""

    def __init__(
        self,
        model_root: Path,
        *,
        pinned_model: PinnedModel = e5_model,
        max_concurrency: int = 2,
        bundle_is_ready: Callable[[], bool] | None = None,
    ) -> None:
        self._model_root = model_root.resolve()
        self._pinned_model = pinned_model
        self._bundle_is_ready = bundle_is_ready
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._session: ort.InferenceSession | None = None
        self._tokenizer: Tokenizer | None = None

    @property
    def dimension(self) -> int:
        return E5_DIMENSION

    @property
    def model_key(self) -> str:
        """Names the model and its vector size, for keying stored vectors."""
        return f"e5-small-{E5_DIMENSION}"

    def _initialize_sync(self) -> None:
        if not verify_manifest(self._model_root, self._pinned_model):
            raise E5EmbeddingError("Knowledge embedding manifest verification failed")
        try:
            tokenizer = Tokenizer.from_file(str(self._model_root / "tokenizer.json"))
            tokenizer.enable_truncation(max_length=E5_MAX_TOKENS)
            pad_id = tokenizer.token_to_id("<pad>")
            if pad_id is None:
                raise E5EmbeddingError("The tokenizer has no padding token")
            tokenizer.enable_padding(pad_id=pad_id, pad_token="<pad>")
            session = ort.InferenceSession(str(self._model_root / E5_MODEL_FILE), providers=["CPUExecutionProvider"])
        except E5EmbeddingError:
            raise
        except Exception as error:
            raise E5EmbeddingError("Knowledge embedding model could not be initialized") from error
        self._tokenizer, self._session = tokenizer, session

    async def initialize(self) -> None:
        if self._session is None:
            async with self._semaphore:
                if self._session is None:
                    await asyncio.to_thread(self._initialize_sync)

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        if self._session is None or self._tokenizer is None:
            raise E5EmbeddingError("Knowledge embedding model is not initialized")
        encodings = self._tokenizer.encode_batch(texts)
        ids = np.asarray([encoding.ids for encoding in encodings], dtype=np.int64)
        mask = np.asarray([encoding.attention_mask for encoding in encodings], dtype=np.int64)
        inputs = {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)}
        wanted = {item.name for item in self._session.get_inputs()}
        try:
            hidden = np.asarray(
                self._session.run(["last_hidden_state"], {k: v for k, v in inputs.items() if k in wanted})[0]
            )
        except Exception as error:
            raise E5EmbeddingError("Knowledge embedding inference failed") from error
        if hidden.ndim != 3 or hidden.shape[2] != E5_DIMENSION:
            raise E5EmbeddingError("Knowledge embedding model returned an unexpected shape")
        weights = mask[:, :, None].astype(np.float32)
        pooled = (hidden * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise E5EmbeddingError("Knowledge embedding model returned a zero vector")
        return (pooled / norms).astype(np.float32).tolist()

    async def embed(self, texts: Sequence[str], role: Role) -> list[list[float]]:
        """Embed texts as queries or as passages; the prefix is added here."""
        if not texts:
            return []
        if any(not text.strip() for text in texts):
            raise ValueError("Text embeddings require non-empty text")
        await self.initialize()
        prefixed = [f"{role}: {text}" for text in texts]
        async with self._semaphore:
            return await asyncio.to_thread(self._embed_sync, prefixed)

    async def embed_query(self, texts: Sequence[str]) -> list[list[float]]:
        return await self.embed(texts, "query")

    async def embed_passage(self, texts: Sequence[str]) -> list[list[float]]:
        return await self.embed(texts, "passage")

    async def close(self) -> None:
        self._session = None
        self._tokenizer = None
