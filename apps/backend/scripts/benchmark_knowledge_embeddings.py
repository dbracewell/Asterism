"""Offline retrieval benchmark for the knowledge embedding model (EPIC-99).

Ranks a small fixed corpus of passages in five languages for queries in the
same and other languages, and reports top-1 accuracy, mean reciprocal rank and
timing. ADR-0079 records its result for this model and for the CLIP model it
replaced. Provision the bundle first (see
docs/architecture/knowledge-retrieval.md), then run from apps/backend:

    uv run python scripts/benchmark_knowledge_embeddings.py --model-root /path/to/e5
"""

import argparse
import asyncio
import resource
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from asterism.domains.knowledge.e5_embedding import OnnxE5EmbeddingProvider

# (topic, language, passage). Each query names the topic it should find.
PASSAGES: list[tuple[str, str, str]] = [
    (
        "photosynthesis",
        "en",
        "Photosynthesis lets plants turn light, water and carbon dioxide into glucose and oxygen.",
    ),
    ("revolution", "en", "The French Revolution began in 1789 with the storming of the Bastille in Paris."),
    ("mitosis", "en", "During mitosis a cell copies its chromosomes and divides into two identical cells."),
    ("photosynthesis", "es", "La fotosíntesis permite a las plantas convertir la luz en energía química."),
    ("pythagoras", "es", "El teorema de Pitágoras relaciona los lados de un triángulo rectángulo: a² + b² = c²."),
    ("water-cycle", "fr", "Le cycle de l'eau comprend l'évaporation, la condensation et les précipitations."),
    ("revolution", "fr", "La Révolution française a commencé en 1789 avec la prise de la Bastille."),
    ("supply-demand", "de", "Wenn die Nachfrage steigt und das Angebot gleich bleibt, steigen die Preise."),
    ("mitosis", "de", "Bei der Mitose teilt sich eine Zelle in zwei genetisch identische Tochterzellen."),
    ("water-cycle", "zh", "水循环包括蒸发、凝结和降水三个主要过程。"),
    ("pythagoras", "zh", "勾股定理说明直角三角形两条直角边的平方和等于斜边的平方。"),
    ("supply-demand", "en", "When demand rises and supply stays the same, prices usually go up."),
]

QUERIES: list[tuple[str, str, str]] = [
    ("photosynthesis", "en", "how do plants make food from sunlight"),
    ("revolution", "en", "when did the French Revolution start"),
    ("mitosis", "en", "how does a cell divide into two"),
    ("pythagoras", "en", "right triangle side lengths formula"),
    ("water-cycle", "en", "evaporation condensation and rain"),
    ("supply-demand", "en", "why do prices increase"),
    ("photosynthesis", "es", "¿cómo producen energía las plantas con la luz?"),
    ("revolution", "fr", "quand a commencé la Révolution française ?"),
    ("supply-demand", "de", "warum steigen die Preise"),
    ("water-cycle", "zh", "水是如何循环的"),
    ("pythagoras", "zh", "直角三角形的边长关系"),
    ("mitosis", "de", "Wie teilt sich eine Zelle?"),
]


@dataclass(frozen=True)
class Result:
    name: str
    initialize_seconds: float
    embed_seconds: float
    top1: float
    mrr: float
    top1_cross_language: float


Embed = Callable[[Sequence[str]], Awaitable[list[list[float]]]]


async def run(name: str, initialize: Callable[[], Awaitable[None]], passages: Embed, queries: Embed) -> Result:
    start = time.perf_counter()
    await initialize()
    initialize_seconds = time.perf_counter() - start
    start = time.perf_counter()
    passage_vectors = await passages([text for _, _, text in PASSAGES])
    query_vectors = await queries([text for _, _, text in QUERIES])
    embed_seconds = time.perf_counter() - start
    top1 = reciprocal = 0.0
    cross_hits = cross_total = 0
    for (topic, language, _), vector in zip(QUERIES, query_vectors):
        scores = [sum(a * b for a, b in zip(vector, passage)) for passage in passage_vectors]
        ranked = sorted(range(len(PASSAGES)), key=lambda index: -scores[index])
        rank = next(position for position, index in enumerate(ranked, 1) if PASSAGES[index][0] == topic)
        top1 += rank == 1
        reciprocal += 1 / rank
        # Does the best passage in another language still find the topic?
        others = [index for index in ranked if PASSAGES[index][1] != language]
        cross_total += 1
        cross_hits += PASSAGES[others[0]][0] == topic
    count = len(QUERIES)
    return Result(name, initialize_seconds, embed_seconds, top1 / count, reciprocal / count, cross_hits / cross_total)


async def main(model_root: Path) -> list[Result]:
    e5 = OnnxE5EmbeddingProvider(model_root)
    return [await run("multilingual-e5-small", e5.initialize, e5.embed_passage, e5.embed_query)]


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True, help="The multilingual-e5-small bundle")
    return parser.parse_args()


if __name__ == "__main__":
    options = arguments()
    for result in asyncio.run(main(options.model_root)):
        print(
            f"{result.name}: top-1 {result.top1:.2f}, MRR {result.mrr:.2f}, "
            f"cross-language top-1 {result.top1_cross_language:.2f}, "
            f"init {result.initialize_seconds:.2f}s, embed {result.embed_seconds:.2f}s"
        )
        if result.name.startswith("multilingual") and result.top1 < 0.75:
            raise SystemExit("multilingual-e5-small ranked fewer than 3 in 4 queries' topic first")
    print(f"max RSS {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss} (KiB on Linux, bytes on macOS)")
