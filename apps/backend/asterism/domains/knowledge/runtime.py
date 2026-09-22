"""Lifecycle-owned knowledge storage services."""

from asterism.core import config

from .caption_download import CaptionModelDownloadService
from .captioning import LocalSmolVlm2CaptionProvider
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
local_caption_provider = LocalSmolVlm2CaptionProvider(
    config.local_caption_models_root,
    bundle_sha256=config.local_caption_model_bundle_sha256,
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
    await vector_store.initialize()
    await knowledge_ingestion_jobs.recover_interrupted()


async def shutdown_knowledge_runtime() -> None:
    await caption_model_download.shutdown()
    await knowledge_ingestion_jobs.shutdown()
    await local_caption_provider.close()
    await embedding_provider.close()
    await vector_store.close()
