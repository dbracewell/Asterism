"""Lifecycle-owned knowledge storage services."""

from asterism.core import config

from .embeddings import OnnxClipEmbeddingProvider
from .jobs import KnowledgeIngestionJobs
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


async def initialize_knowledge_runtime() -> None:
    """Create/open LanceDB and make interrupted jobs explicitly retryable."""
    await vector_store.initialize()
    await knowledge_ingestion_jobs.recover_interrupted()


async def shutdown_knowledge_runtime() -> None:
    await knowledge_ingestion_jobs.shutdown()
    await embedding_provider.close()
    await vector_store.close()
