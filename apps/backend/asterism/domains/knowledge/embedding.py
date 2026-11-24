"""The knowledge embedding model: pinned multilingual-e5-small, text only (ADR-0079).

Every knowledge and memory vector comes from this one provider. Callers say
whether they embed what is searched for (``embed_query``) or what is searched
(``embed_passage``); an image is found through its caption, never its pixels.
"""

from collections.abc import Sequence
from typing import Protocol

from asterism.core import config

from .e5_embedding import E5EmbeddingError as EmbeddingProviderError
from .e5_embedding import OnnxE5EmbeddingProvider, e5_model
from .model_download import ModelDownloadService

__all__ = [
    "EMBEDDING_MODEL_KEY",
    "EmbeddingProvider",
    "EmbeddingProviderError",
    "embedding_download_service",
    "embedding_model",
    "embedding_provider",
]


class EmbeddingProvider(Protocol):
    @property
    def dimension(self) -> int: ...
    @property
    def model_key(self) -> str: ...
    async def initialize(self) -> None: ...
    async def embed_query(self, texts: Sequence[str]) -> list[list[float]]: ...
    async def embed_passage(self, texts: Sequence[str]) -> list[list[float]]: ...
    async def close(self) -> None: ...


embedding_model = e5_model

embedding_download_service = ModelDownloadService(
    model_root=config.knowledge_models_root,
    pinned_model=embedding_model,
)

embedding_provider = OnnxE5EmbeddingProvider(
    config.knowledge_models_root,
    pinned_model=embedding_model,
    max_concurrency=config.max_concurrent_knowledge_embeddings,
    bundle_is_ready=embedding_download_service.is_ready,
)

# Recorded in the processing policy and in vector table names: a change of
# model is a change of this key, which re-embeds every file (ADR-0079).
EMBEDDING_MODEL_KEY = embedding_provider.model_key
