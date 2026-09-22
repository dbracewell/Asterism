"""Lifecycle-owned knowledge storage services."""

from asterism.core import config

from .embeddings import OnnxClipEmbeddingProvider
from .vector_store import LanceDbVectorStore

vector_store = LanceDbVectorStore(
    config.knowledge_root / "lancedb",
    dimension=config.knowledge_embedding_dimension,
    max_concurrency=config.max_concurrent_knowledge_vector_operations,
)
embedding_provider = OnnxClipEmbeddingProvider(
    config.knowledge_models_root,
    artifact_sha256=config.knowledge_embedding_model_sha256,
    artifact_size_bytes=config.knowledge_embedding_model_size_bytes,
    dimension=config.knowledge_embedding_dimension,
    max_concurrency=config.max_concurrent_knowledge_embeddings,
)


async def initialize_knowledge_runtime() -> None:
    """Create/open LanceDB. The model remains lazy until a document needs it."""
    await vector_store.initialize()


async def shutdown_knowledge_runtime() -> None:
    await embedding_provider.close()
    await vector_store.close()
