"""The pinned local model catalog (ADR-0064, US-76.2).

Revisions and file layouts were checked against Hugging Face on 2026-11-09.
Memory figures are estimates for bf16 weights plus working memory at 1024²:
``memory_gb`` with every component on the device, ``offload_gb`` the peak
with diffusers model CPU offload (CUDA only). Order is preference: the first
entry that fits is recommended, favoring lightly filtered models.
"""

from dataclasses import dataclass, field

from asterism.domains.knowledge.model_download import PinnedModel

DIFFUSERS_LAYOUT = [
    "model_index.json",
    "scheduler/*",
    "tokenizer/*",
    "processor/*",
    "text_encoder/*",
    "transformer/*",
    "vae/*",
]


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    name: str
    repo: str
    revision: str
    pipeline: str
    license: str
    commercial_use: bool
    description: str
    disk_gb: float
    memory_gb: float
    offload_gb: float
    steps: int | None
    guidance: float | None = None
    # Extra pipeline arguments, passed only when the pipeline accepts them.
    extra: dict[str, object] = field(default_factory=dict)

    def pinned(self) -> PinnedModel:
        return PinnedModel(id=self.repo, revision=self.revision, allow_patterns=list(DIFFUSERS_LAYOUT))


CATALOG: tuple[CatalogEntry, ...] = (
    CatalogEntry(
        id="qwen-image-2.1-turbo",
        name="Qwen-Image-2.1 Turbo",
        repo="Qwen/Qwen-Image-2.1-Turbo",
        revision="fc13ba1986fcb905854dc8de2f52eee395f49b5b",
        pipeline="QwenImage21Pipeline",
        license="Qwen Research License (non-commercial)",
        commercial_use=False,
        description="Best quality and in-image text; 8 steps; lightly filtered.",
        disk_gb=32.5,
        memory_gb=36.0,
        offload_gb=20.0,
        steps=None,  # The checkpoint's own 8-step schedule.
    ),
    CatalogEntry(
        id="qwen-image-2.1",
        name="Qwen-Image-2.1",
        repo="Qwen/Qwen-Image-2.1",
        revision="d26bb61231c349cf6b7896fa83353113880e1ba3",
        pipeline="QwenImage21Pipeline",
        license="Qwen Research License (non-commercial)",
        commercial_use=False,
        description="The full model: same quality ceiling as Turbo, 40 steps, about five times slower.",
        disk_gb=33.1,
        memory_gb=36.0,
        offload_gb=20.0,
        steps=40,
    ),
    CatalogEntry(
        id="z-image-turbo",
        name="Z-Image-Turbo",
        repo="Tongyi-MAI/Z-Image-Turbo",
        revision="f332072aa78be7aecdf3ee76d5c247082da564a6",
        pipeline="ZImagePipeline",
        license="Apache 2.0",
        commercial_use=True,
        description="Fast photorealistic images in 8 steps; lightly filtered.",
        disk_gb=32.9,
        memory_gb=23.0,
        offload_gb=14.0,
        steps=9,
        guidance=0.0,
    ),
    CatalogEntry(
        id="flux2-klein-4b",
        name="FLUX.2 [klein] 4B",
        repo="black-forest-labs/FLUX.2-klein-4B",
        revision="e7b7dc27f91deacad38e78976d1f2b499d76a294",
        pipeline="Flux2KleinPipeline",
        license="Apache 2.0",
        commercial_use=True,
        description="The smallest: 4 steps, good prompt following; for 8–16 GB GPUs, smaller Macs and CPU.",
        disk_gb=16.0,
        memory_gb=18.0,
        offload_gb=10.0,
        steps=4,
        guidance=1.0,
    ),
)

BY_ID = {entry.id: entry for entry in CATALOG}


def entry(model_id: str) -> CatalogEntry | None:
    return BY_ID.get(model_id)
