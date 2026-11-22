"""Model bundle downloads, one pinned service per ONNX catalog model (US-94.4)."""

import asyncio
import shutil

from asterism.core import config
from asterism.domains.knowledge.model_download import ModelDownloadService

from .catalog import OnnxCatalogEntry

_SERVICES: dict[str, ModelDownloadService] = {}


def service(entry: OnnxCatalogEntry) -> ModelDownloadService:
    found = _SERVICES.get(entry.id)
    if found is None:
        found = _SERVICES[entry.id] = ModelDownloadService(
            model_root=config.image_models_root / "onnx" / entry.id, pinned_model=entry.pinned()
        )
    return found


def model_dir(entry: OnnxCatalogEntry) -> str:
    return str(service(entry).model_root)


async def remove(entry: OnnxCatalogEntry) -> None:
    """Cancel any download and delete the model's files."""
    downloads = service(entry)
    await downloads.cancel_download()
    root = downloads.model_root
    _SERVICES.pop(entry.id, None)
    for path in (root, root.with_name(f"{root.name}.staging"), root.with_name(f"{root.name}.previous")):
        await asyncio.to_thread(shutil.rmtree, path, True)


async def shutdown() -> None:
    for downloads in list(_SERVICES.values()):
        await downloads.shutdown()
