"""Offline, deterministic smoke/relevance benchmark for the pinned CLIP artifact.

Provision the model as documented in docs/architecture/knowledge-retrieval.md,
then run from apps/backend:
    uv run python scripts/benchmark_knowledge_embeddings.py --model-root /path/to/model
"""

import argparse
import asyncio
import resource
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from asterism.domains.knowledge.embeddings import OnnxClipEmbeddingProvider
from PIL import Image

ARTIFACT_SHA256 = "0898a3facfdb27f0a041e57649b4989cfd094e4a0040d6ae75ed69917dfc7328"
ARTIFACT_SIZE_BYTES = 153_695_702


@dataclass(frozen=True)
class BenchmarkResult:
    initialize_seconds: float
    text_seconds: float
    image_seconds: float
    red_query_scores: list[float]
    blue_query_scores: list[float]
    max_rss_kib: int


def cosine(left: list[float], right: list[float]) -> float:
    return sum(first * second for first, second in zip(left, right))


async def benchmark(model_root: Path) -> BenchmarkResult:
    provider = OnnxClipEmbeddingProvider(
        model_root,
        artifact_sha256=ARTIFACT_SHA256,
        artifact_size_bytes=ARTIFACT_SIZE_BYTES,
        max_concurrency=1,
    )
    start = time.perf_counter()
    await provider.initialize()
    initialize_seconds = time.perf_counter() - start
    start = time.perf_counter()
    text_embeddings = await provider.embed_text(["a red square", "a blue square"])
    text_seconds = time.perf_counter() - start
    with tempfile.TemporaryDirectory(prefix="asterism-knowledge-benchmark-") as directory:
        root = Path(directory)
        red, blue = root / "red.png", root / "blue.png"
        Image.new("RGB", (224, 224), "red").save(red)
        Image.new("RGB", (224, 224), "blue").save(blue)
        start = time.perf_counter()
        image_embeddings = await provider.embed_image([red, blue])
        image_seconds = time.perf_counter() - start
    await provider.close()
    return BenchmarkResult(
        initialize_seconds=initialize_seconds,
        text_seconds=text_seconds,
        image_seconds=image_seconds,
        red_query_scores=[cosine(text_embeddings[0], image) for image in image_embeddings],
        blue_query_scores=[cosine(text_embeddings[1], image) for image in image_embeddings],
        max_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    )


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    result = asyncio.run(benchmark(arguments().model_root))
    print(result)
    if not (result.red_query_scores[0] > result.red_query_scores[1]):
        raise SystemExit("Red query did not rank the red image above blue")
    if not (result.blue_query_scores[1] > result.blue_query_scores[0]):
        raise SystemExit("Blue query did not rank the blue image above red")
