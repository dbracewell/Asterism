"""The local diffusers provider (ADR-0064, US-76.2)."""

import random

from pydantic import BaseModel, ConfigDict

from asterism.domains.components.registry import component_registry

from ..providers import ImageGenerationError, ImageGeneratorComponent, ProgressCallback
from ..schemas import ImageProviderStatus, ImageRequest, ProviderImage, ProviderResult
from . import downloads
from .catalog import CatalogEntry, entry
from .hardware import cached_detect
from .planning import dtype_for, plan
from .runtime import WorkerKey, runtime
from .settings import LocalSettings, read_settings


def native_size(width: int, height: int, resolution: int) -> tuple[int, int]:
    """Scale a request larger than the model's native area down to it, keeping the aspect ratio.

    Sides are multiples of 64; smaller requests are kept.
    """
    if width * height <= resolution * resolution:
        return width, height
    scale = (resolution * resolution / (width * height)) ** 0.5
    return max(64, round(width * scale / 64) * 64), max(64, round(height * scale / 64) * 64)


class DiffusersParameters(BaseModel):
    """No form fields: the model and device are chosen on the local models page,
    which also handles downloads and licenses (US-76.2)."""

    model_config = ConfigDict(extra="ignore")


async def _local_settings() -> LocalSettings:
    from asterism.db import database

    async with database.get_async_db_session() as session:
        return await read_settings(session)


@component_registry.register()
class Diffusers(ImageGeneratorComponent[DiffusersParameters]):
    """A local diffusers model run in a worker process by this backend."""

    name = "Diffusers"
    parameters = DiffusersParameters

    @staticmethod
    def _chosen(settings: LocalSettings) -> CatalogEntry | None:
        return entry(settings.model_id) if settings.model_id else None

    async def status(self) -> ImageProviderStatus:
        settings = await _local_settings()
        model = self._chosen(settings)
        if model is None:
            return ImageProviderStatus(provider=self.name, ready=False, detail="Choose a local model")
        if not downloads.service(model).is_ready():
            return ImageProviderStatus(provider=self.name, ready=False, detail=f"Download {model.name} first")
        fit = plan(model, cached_detect(settings.device))
        if not fit.fits:
            return ImageProviderStatus(provider=self.name, ready=False, detail=fit.detail)
        return ImageProviderStatus(provider=self.name, ready=True, detail=f"{model.name}: {fit.detail}")

    async def __call__(self, request: ImageRequest, progress: ProgressCallback) -> ProviderResult:
        settings = await _local_settings()
        model = self._chosen(settings)
        if model is None or not downloads.service(model).is_ready():
            raise ImageGenerationError("The local model isn't ready")
        hardware = cached_detect(settings.device)
        fit = plan(model, hardware)
        if not fit.fits:
            raise ImageGenerationError(fit.detail)
        seed = request.seed if request.seed is not None else random.randrange(2**32 - request.count)
        steps = request.steps or model.steps
        width, height = native_size(request.width, request.height, model.resolution)
        images = await runtime.generate(
            WorkerKey(
                model_dir=downloads.model_dir(model),
                pipeline=model.pipeline,
                device=hardware.device,
                mode=fit.mode,
                dtype=dtype_for(model, hardware),
                scheduler=model.scheduler,
            ),
            {
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "width": width,
                "height": height,
                "count": request.count,
                "seed": seed,
                "steps": steps,
                "guidance": model.guidance,
                "extra": model.extra,
            },
            progress,
        )
        return ProviderResult(
            images=[ProviderImage(png=data, seed=used, width=width, height=height) for data, used in images],
            model=model.repo,
            revision=model.revision,
            steps=steps,
        )
