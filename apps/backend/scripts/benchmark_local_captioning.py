"""Benchmark a provisioned local SmolVLM2 ONNX caption bundle (ADR-0077).

Run only against a bundle the admin download has provisioned and verified;
captioning never downloads anything:

    uv run python scripts/benchmark_local_captioning.py \
      --model-root /storage/models/captioning-smolvlm2 \
      [--images <directory of images>] --output caption-benchmark.json

Without ``--images`` it captions one generated 224 px red square. Each image is
captioned once, in name order, after a cold initialize; peak RSS is the
process's high-water mark after that image.
"""

import argparse
import asyncio
import json
import platform
import resource
import time
import uuid
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path

from asterism.domains.knowledge.caption_schemas import CaptionRequest
from asterism.domains.knowledge.captioning import (
    CAPTION_MODEL_PRECISION,
    OnnxSmolVlm2CaptionProvider,
    caption_model,
    caption_model_files,
)
from asterism.domains.knowledge.sources import SourceFile
from PIL import Image


@dataclass(frozen=True)
class ImageResult:
    image: str
    seconds: float
    peak_rss_bytes: int
    caption: str


@dataclass(frozen=True)
class CaptionBenchmarkResult:
    platform: str
    architecture: str
    precision: str
    bundle_size_bytes: int
    cold_initialize_seconds: float
    images: list[ImageResult]


def _bundle_size(root: Path) -> int:
    return sum((root / path).stat().st_size for path in caption_model.files)


def _peak_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # Linux reports KiB; macOS reports bytes.
    return value if platform.system() == "Darwin" else value * 1024


def _images(directory: Path | None) -> list[tuple[str, bytes]]:
    if directory is None:
        buffer = BytesIO()
        Image.new("RGB", (224, 224), "red").save(buffer, format="PNG")
        return [("red-square.png", buffer.getvalue())]
    return [(path.name, path.read_bytes()) for path in sorted(directory.iterdir()) if path.is_file()]


def _request(name: str, content: bytes) -> CaptionRequest:
    file = SourceFile(
        id=uuid.uuid4(),
        user_id="benchmark",
        name=name,
        mime_type="image/png",
        is_image=True,
    )
    return CaptionRequest(
        revision_id=uuid.uuid4(),
        image=content,
        file=file,
        max_image_bytes=len(content),
        max_caption_chars=2_000,
    )


async def benchmark(model_root: Path, images: Path | None) -> CaptionBenchmarkResult:
    provider = OnnxSmolVlm2CaptionProvider(
        model_root,
        pinned_model=caption_model,
        files=caption_model_files,
        timeout_s=600,
    )
    started = time.perf_counter()
    await provider.initialize()
    cold_initialize_seconds = time.perf_counter() - started
    results: list[ImageResult] = []
    for name, content in _images(images):
        started = time.perf_counter()
        result = await provider.caption(_request(name, content))
        results.append(ImageResult(name, round(time.perf_counter() - started, 2), _peak_rss_bytes(), result.text))
    await provider.close()
    return CaptionBenchmarkResult(
        platform=platform.system(),
        architecture=platform.machine(),
        precision=CAPTION_MODEL_PRECISION,
        bundle_size_bytes=_bundle_size(model_root),
        cold_initialize_seconds=round(cold_initialize_seconds, 2),
        images=results,
    )


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--images", type=Path, default=None)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = arguments()
    result = asyncio.run(benchmark(args.model_root, args.images))
    args.output.write_text(json.dumps(asdict(result), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
