"""Benchmark a provisioned local SmolVLM2 CPU caption bundle.

Run only after the operator has reviewed, downloaded, and manifest-pinned the
bundle. Caption requests never download artifacts:
    uv run python scripts/benchmark_local_captioning.py \
      --model-root /storage/models/captioning-smolvlm2 \
      --bundle-sha256 <manifest-sha256> --output caption-benchmark.json
"""

import argparse
import asyncio
import json
import platform
import resource
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from uuid import uuid4

from asterism.domains.knowledge.captioning import CaptionRequest, LocalSmolVlm2CaptionProvider
from PIL import Image


@dataclass(frozen=True)
class CaptionBenchmarkResult:
    platform: str
    architecture: str
    artifact_size_bytes: int
    cold_initialize_seconds: float
    cold_caption_seconds: float
    warm_caption_seconds: float
    concurrent_caption_seconds: float
    concurrency: int
    peak_rss_bytes: int
    captions: list[str]


def _artifact_size(root: Path) -> int:
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file() and not path.is_symlink())


def _peak_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports KiB; macOS reports bytes.
    return value if platform.system() == "Darwin" else value * 1024


async def benchmark(model_root: Path, bundle_sha256: str, *, concurrency: int) -> CaptionBenchmarkResult:
    provider = LocalSmolVlm2CaptionProvider(
        model_root,
        bundle_sha256=bundle_sha256,
        max_concurrency=concurrency,
    )
    with tempfile.TemporaryDirectory(prefix="asterism-caption-benchmark-") as directory:
        image_path = Path(directory) / "fixture.png"
        Image.new("RGB", (224, 224), "red").save(image_path)
        request = CaptionRequest(
            revision_id=uuid4(), image_path=image_path, max_image_bytes=1024 * 1024, max_caption_chars=2_000
        )
        started = time.perf_counter()
        await provider.initialize()
        cold_initialize_seconds = time.perf_counter() - started
        started = time.perf_counter()
        cold = await provider.caption(request)
        cold_caption_seconds = time.perf_counter() - started
        started = time.perf_counter()
        warm = await provider.caption(request)
        warm_caption_seconds = time.perf_counter() - started
        started = time.perf_counter()
        concurrent = await asyncio.gather(*(provider.caption(request) for _ in range(concurrency)))
        concurrent_caption_seconds = time.perf_counter() - started
    await provider.close()
    return CaptionBenchmarkResult(
        platform=platform.system(),
        architecture=platform.machine(),
        artifact_size_bytes=_artifact_size(model_root),
        cold_initialize_seconds=cold_initialize_seconds,
        cold_caption_seconds=cold_caption_seconds,
        warm_caption_seconds=warm_caption_seconds,
        concurrent_caption_seconds=concurrent_caption_seconds,
        concurrency=concurrency,
        peak_rss_bytes=_peak_rss_bytes(),
        captions=[cold.text, warm.text, *(result.text for result in concurrent)],
    )


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--bundle-sha256", required=True)
    parser.add_argument("--concurrency", type=int, default=1, choices=range(1, 5))
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = arguments()
    result = asyncio.run(benchmark(args.model_root, args.bundle_sha256, concurrency=args.concurrency))
    args.output.write_text(json.dumps(asdict(result), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
