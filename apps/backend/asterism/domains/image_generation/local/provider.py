"""The local diffusers provider (ADR-0064, US-76.2)."""

import random

from sqlalchemy.ext.asyncio import AsyncSession

from ..providers import ImageGenerationError, ProgressCallback, register_provider
from ..schemas import ImageProviderStatus, ImageRequest, ProviderImage, ProviderResult
from . import downloads
from .catalog import CatalogEntry, entry
from .hardware import HardwareReport, cached_detect
from .planning import plan
from .runtime import WorkerKey, runtime
from .settings import LocalSettings, read_settings


def dtype_for(hardware: HardwareReport) -> str:
    if hardware.device == "cuda" and not hardware.bf16:
        return "float16"
    return "bfloat16"


class DiffusersProvider:
    name = "diffusers"

    def __init__(self, settings: LocalSettings):
        self.settings = settings

    def _chosen(self) -> CatalogEntry | None:
        return entry(self.settings.model_id) if self.settings.model_id else None

    async def status(self) -> ImageProviderStatus:
        model = self._chosen()
        if model is None:
            return ImageProviderStatus(provider="diffusers", ready=False, detail="Choose a local model")
        if not downloads.service(model).is_ready():
            return ImageProviderStatus(provider="diffusers", ready=False, detail=f"Download {model.name} first")
        fit = plan(model, cached_detect(self.settings.device))
        if not fit.fits:
            return ImageProviderStatus(provider="diffusers", ready=False, detail=fit.detail)
        return ImageProviderStatus(provider="diffusers", ready=True, detail=f"{model.name}: {fit.detail}")

    async def generate(self, request: ImageRequest, progress: ProgressCallback) -> ProviderResult:
        model = self._chosen()
        if model is None or not downloads.service(model).is_ready():
            raise ImageGenerationError("The local model isn't ready")
        hardware = cached_detect(self.settings.device)
        fit = plan(model, hardware)
        if not fit.fits:
            raise ImageGenerationError(fit.detail)
        seed = request.seed if request.seed is not None else random.randrange(2**32 - request.count)
        steps = request.steps or model.steps
        images = await runtime.generate(
            WorkerKey(
                model_dir=downloads.model_dir(model),
                pipeline=model.pipeline,
                device=hardware.device,
                mode=fit.mode,
                dtype=dtype_for(hardware),
            ),
            {
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "width": request.width,
                "height": request.height,
                "count": request.count,
                "seed": seed,
                "steps": steps,
                "guidance": model.guidance,
                "extra": model.extra,
            },
            progress,
        )
        return ProviderResult(
            images=[
                ProviderImage(png=data, seed=used, width=request.width, height=request.height) for data, used in images
            ],
            model=model.repo,
            revision=model.revision,
            steps=steps,
        )


async def _factory(session: AsyncSession) -> DiffusersProvider:
    return DiffusersProvider(await read_settings(session))


register_provider("diffusers", _factory)
