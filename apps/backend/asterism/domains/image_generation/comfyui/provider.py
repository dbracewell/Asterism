"""The ComfyUI provider (ADR-0064, US-76.3).

Each image is its own queued prompt with seed, seed + 1, …, so a seed means
the same thing as with the local generator. Completion is read from
``/history``; the WebSocket only adds step progress.
"""

import asyncio
import hashlib
import io
import random
import time
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..providers import ImageGenerationError, ProgressCallback, register_provider
from ..schemas import ImageProgress, ImageProviderStatus, ImageRequest, ProviderImage, ProviderResult
from .client import ComfyUIClient
from .schemas import ComfyUISettings
from .settings import read_settings
from .workflow import DEFAULT_WORKFLOW, check_workflow, fill

POLL_SECONDS = 0.5
PROBE_TTL_SECONDS = 30.0
# Fingerprint of the settings → (checked at, error or None).
_PROBES: dict[str, tuple[float, str | None]] = {}


def clear_probes() -> None:
    _PROBES.clear()


def _fingerprint(settings: ComfyUISettings) -> str:
    return hashlib.sha256(settings.model_dump_json().encode()).hexdigest()


def configuration_problem(settings: ComfyUISettings) -> str | None:
    if not settings.base_url:
        return "Set the ComfyUI server address"
    if settings.workflow is None:
        if not settings.checkpoint:
            return "Choose a checkpoint for the ComfyUI workflow"
        return None
    try:
        check_workflow(settings.workflow)
    except ValueError as error:
        return f"The ComfyUI workflow can't be used: {error}"
    return None


def _image_refs(entry: dict[str, Any]) -> list[dict[str, Any]]:
    refs = [
        image
        for output in (entry.get("outputs") or {}).values()
        for image in (output.get("images") or [])
        if isinstance(image, dict) and image.get("filename")
    ]
    saved = [image for image in refs if image.get("type") == "output"]
    return saved or refs


def _failure(entry: dict[str, Any]) -> str | None:
    status = entry.get("status") or {}
    if status.get("status_str") != "error":
        return None
    for name, data in status.get("messages") or []:
        if name == "execution_error":
            node = data.get("node_type", "a node")
            return f"ComfyUI failed in {node}: {str(data.get('exception_message', '')).strip()[:300]}"
        if name == "execution_interrupted":
            return "The ComfyUI job was interrupted"
    return "ComfyUI reported an error"


class ComfyUIProvider:
    name = "comfyui"

    def __init__(self, settings: ComfyUISettings):
        self.settings = settings

    async def status(self) -> ImageProviderStatus:
        problem = configuration_problem(self.settings)
        if problem:
            return ImageProviderStatus(provider="comfyui", ready=False, detail=problem)
        key = _fingerprint(self.settings)
        checked = _PROBES.get(key)
        if checked is None or time.monotonic() - checked[0] > PROBE_TTL_SECONDS:
            error = None
            try:
                async with ComfyUIClient(self.settings) as client:
                    await client.system_stats()
            except ImageGenerationError as failure:
                error = str(failure)
            checked = _PROBES[key] = (time.monotonic(), error)
        if checked[1]:
            return ImageProviderStatus(provider="comfyui", ready=False, detail=checked[1])
        return ImageProviderStatus(provider="comfyui", ready=True, detail=f"ComfyUI at {self.settings.base_url}")

    async def generate(self, request: ImageRequest, progress: ProgressCallback) -> ProviderResult:
        problem = configuration_problem(self.settings)
        if problem:
            raise ImageGenerationError(problem)
        workflow = self.settings.workflow or DEFAULT_WORKFLOW
        seed = request.seed if request.seed is not None else random.randrange(2**32 - request.count)
        steps = request.steps or self.settings.steps
        images: list[ProviderImage] = []
        try:
            async with asyncio.timeout(self.settings.timeout_seconds), ComfyUIClient(self.settings) as client:
                for index in range(request.count):
                    values = {
                        "prompt": request.prompt,
                        "negative_prompt": request.negative_prompt,
                        "width": request.width,
                        "height": request.height,
                        "seed": seed + index,
                        "steps": steps,
                        "guidance": self.settings.guidance,
                        "checkpoint": self.settings.checkpoint,
                    }
                    images += await self._one(
                        client, fill(workflow, values), seed + index, index, request.count, progress
                    )
        except TimeoutError as error:
            raise ImageGenerationError(
                f"ComfyUI didn't finish within {self.settings.timeout_seconds} seconds"
            ) from error
        return ProviderResult(
            images=images,
            model=self.settings.checkpoint if self.settings.workflow is None else "ComfyUI workflow",
            steps=steps,
        )

    async def _one(
        self, client: ComfyUIClient, workflow: dict[str, Any], seed: int, index: int, count: int, progress
    ) -> list[ProviderImage]:
        from PIL import Image

        async def on_step(value: int, total: int) -> None:
            if total > 0:
                await progress(ImageProgress(stage="running", step=index * total + value, total=count * total))

        client_id = uuid.uuid4().hex
        connected = asyncio.Event()
        listener = asyncio.create_task(client.listen(client_id, on_step, connected))
        prompt_id: str | None = None
        try:
            # Wait briefly for the socket so early steps aren't missed.
            try:
                await asyncio.wait_for(connected.wait(), 5)
            except TimeoutError:
                pass
            prompt_id = await client.queue(workflow, client_id)
            while True:
                entry = await client.history(prompt_id)
                if entry is not None:
                    failure = _failure(entry)
                    if failure:
                        raise ImageGenerationError(failure)
                    if (entry.get("status") or {}).get("completed", True) and entry.get("outputs") is not None:
                        break
                await asyncio.sleep(POLL_SECONDS)
            refs = _image_refs(entry)
            if not refs:
                raise ImageGenerationError("The ComfyUI workflow produced no images; add a Save Image node")
            images = []
            for ref in refs:
                data = await client.image(ref)
                try:
                    with Image.open(io.BytesIO(data)) as opened:
                        width, height = opened.size
                except Exception as error:  # noqa: BLE001 - Pillow raises several types
                    raise ImageGenerationError("ComfyUI sent a file that isn't an image") from error
                images.append(ProviderImage(png=data, seed=seed, width=width, height=height))
            return images
        except BaseException:
            if prompt_id is not None:
                await asyncio.shield(client.cancel(prompt_id))
            raise
        finally:
            listener.cancel()
            await asyncio.gather(listener, return_exceptions=True)


async def _factory(session: AsyncSession) -> ComfyUIProvider:
    return ComfyUIProvider(await read_settings(session))


register_provider("comfyui", _factory)
