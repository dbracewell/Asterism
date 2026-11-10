"""The pinned local model catalog (ADR-0064, US-76.2).

Revisions and file layouts were checked against Hugging Face on 2026-11-09.
Memory figures are estimates for bf16 weights plus working memory at 1024²:
``memory_gb`` with every component on the device, ``offload_gb`` the peak
with diffusers model CPU offload (CUDA only), both at the model's native
resolution. Order is preference: the first entry that fits is recommended,
favoring lightly filtered models; the last two are small Stable Diffusion
fine-tunes for 3-8 GB GPUs, 8-16 GB Macs and CPU.
"""

from dataclasses import dataclass, field

from asterism.domains.knowledge.model_download import PinnedModel

DIFFUSERS_LAYOUT = (
    "model_index.json",
    "scheduler/*",
    "tokenizer/*",
    "processor/*",
    "text_encoder/*",
    "transformer/*",
    "vae/*",
)

# SDXL with only the fp16 weights (the repository also has fp32 copies).
SDXL_FP16_LAYOUT = (
    "model_index.json",
    "scheduler/*",
    "tokenizer/*",
    "tokenizer_2/*",
    "text_encoder/config.json",
    "text_encoder/model.fp16.safetensors",
    "text_encoder_2/config.json",
    "text_encoder_2/model.fp16.safetensors",
    "unet/config.json",
    "unet/diffusion_pytorch_model.fp16.safetensors",
    "vae/config.json",
    "vae/diffusion_pytorch_model.fp16.safetensors",
)

# Stable Diffusion 1.5 without the separate safety checker model (ADR-0064:
# the platform's prompt check governs), the single-file checkpoint or fp32 duplicates.
SD15_LAYOUT = (
    "model_index.json",
    "scheduler/*",
    "tokenizer/*",
    "text_encoder/*",
    "unet/*",
    "vae/*",
)


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
    files: tuple[str, ...] = DIFFUSERS_LAYOUT
    # A diffusers scheduler class replacing the checkpoint's own (its config is kept).
    scheduler: str | None = None
    # The square side the model was trained at; larger requests are scaled to its area.
    resolution: int = 1024
    # Trained in fp16, so fp16 is safe where bf16 is slow; bf16-trained models
    # can overflow in fp16 and fall back to float32 instead.
    fp16_ok: bool = False

    def pinned(self) -> PinnedModel:
        return PinnedModel(id=self.repo, revision=self.revision, allow_patterns=list(self.files))


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
        description="4 steps with good prompt following; for 12–16 GB GPUs and 32 GB Macs.",
        disk_gb=16.0,
        memory_gb=18.0,
        offload_gb=10.0,
        steps=4,
        guidance=1.0,
    ),
    CatalogEntry(
        id="dreamshaper-xl-lightning",
        name="DreamShaper XL Lightning",
        repo="Lykon/dreamshaper-xl-lightning",
        revision="561086c22aba3925b1e8803a73857f061635c7c3",
        pipeline="StableDiffusionXLPipeline",
        license="CreativeML Open RAIL++-M",
        commercial_use=True,
        description="An unfiltered SDXL community fine-tune in 4 steps; for 8 GB GPUs and 16 GB Macs.",
        disk_gb=7.0,
        memory_gb=9.0,
        offload_gb=5.5,
        steps=4,
        guidance=2.0,
        files=SDXL_FP16_LAYOUT,
        # The model card's scheduler for its 4-step schedule.
        scheduler="DPMSolverMultistepScheduler",
        fp16_ok=True,
    ),
    CatalogEntry(
        id="dreamshaper-8-lcm",
        name="DreamShaper 8 LCM",
        repo="Lykon/dreamshaper-8-lcm",
        revision="4645d8bc6a8e6b106d21606d63e8460cdad4f1a6",
        pipeline="StableDiffusionPipeline",
        license="CreativeML Open RAIL-M",
        commercial_use=True,
        description="The smallest: an unfiltered Stable Diffusion 1.5 fine-tune at 512 px in 8 steps; "
        "for 3–6 GB GPUs, 8 GB Macs and CPU.",
        disk_gb=4.3,
        memory_gb=2.8,
        offload_gb=2.0,
        steps=8,
        guidance=1.5,
        files=SD15_LAYOUT,
        scheduler="LCMScheduler",
        resolution=512,
        fp16_ok=True,
    ),
)

BY_ID = {entry.id: entry for entry in CATALOG}


def entry(model_id: str) -> CatalogEntry | None:
    return BY_ID.get(model_id)
