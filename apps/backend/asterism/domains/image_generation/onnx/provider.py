"""The ONNX generator: Stable Diffusion on the CPU, in every build (ADR-0077, US-94.4)."""

import random

from pydantic import BaseModel, ConfigDict

from asterism.domains.components.registry import component_registry

from ..local.provider import native_size
from ..local.runtime import WorkerKey, runtime
from ..local.worker import ONNX_PREFIX
from ..providers import ImageGenerationError, ImageGeneratorComponent, ProgressCallback
from ..schemas import ImageProviderStatus, ImageRequest, ProviderImage, ProviderResult
from . import downloads
from .catalog import OnnxCatalogEntry, entry
from .planning import plan, server_ram_gb
from .schemas import OnnxSettings
from .settings import read_settings

NAME = "ONNX"


class OnnxParameters(BaseModel):
    """No form fields: the model is chosen on the ONNX models page, which also handles
    downloads and licenses (US-94.4)."""

    model_config = ConfigDict(extra="ignore")


async def _settings() -> OnnxSettings:
    from asterism.db import database

    async with database.get_async_db_session() as session:
        return await read_settings(session)


def _chosen(settings: OnnxSettings) -> OnnxCatalogEntry | None:
    return entry(settings.model_id) if settings.model_id else None


@component_registry.register()
class Onnx(ImageGeneratorComponent[OnnxParameters]):
    """A pinned Stable Diffusion model on ONNX Runtime, run on the CPU in a worker process."""

    name = NAME
    parameters = OnnxParameters

    async def status(self) -> ImageProviderStatus:
        model = _chosen(await _settings())
        if model is None:
            return ImageProviderStatus(provider=self.name, ready=False, detail="Choose an ONNX model")
        if not await downloads.service(model).ready():
            return ImageProviderStatus(provider=self.name, ready=False, detail=f"Download {model.name} first")
        fit = plan(model, server_ram_gb())
        if not fit.fits:
            return ImageProviderStatus(provider=self.name, ready=False, detail=fit.detail)
        return ImageProviderStatus(provider=self.name, ready=True, detail=f"{model.name}: {fit.detail}")

    async def __call__(self, request: ImageRequest, progress: ProgressCallback) -> ProviderResult:
        model = _chosen(await _settings())
        if model is None or not await downloads.service(model).ready():
            raise ImageGenerationError("The ONNX model isn't ready")
        fit = plan(model, server_ram_gb())
        if not fit.fits:
            raise ImageGenerationError(fit.detail)
        seed = request.seed if request.seed is not None else random.randrange(2**32 - request.count)
        steps = min(request.steps or model.steps, model.max_steps)
        width, height = native_size(request.width, request.height, model.resolution)
        images = await runtime.generate(
            WorkerKey(
                model_dir=downloads.model_dir(model),
                pipeline=f"{ONNX_PREFIX}{model.family}",
                device="cpu",
                mode="device",
                dtype="mixed-int8",
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
