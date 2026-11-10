"""Model bundle downloads, one pinned service per catalog model (US-76.2)."""

import asyncio
import shutil

from asterism.core import config
from asterism.domains.knowledge.model_download import ModelDownloadService

from .catalog import CatalogEntry

_SERVICES: dict[str, ModelDownloadService] = {}


def service(entry: CatalogEntry) -> ModelDownloadService:
    found = _SERVICES.get(entry.id)
    if found is None:
        found = _SERVICES[entry.id] = ModelDownloadService(
            model_root=config.image_models_root / entry.id, pinned_model=entry.pinned()
        )
    return found


def model_dir(entry: CatalogEntry) -> str:
    return str(service(entry).model_root)


async def remove(entry: CatalogEntry) -> None:
    """Cancel any download and delete the model's files."""
    downloads = service(entry)
    await downloads.cancel_download()
    root = downloads.model_root
    _SERVICES.pop(entry.id, None)
    await asyncio.to_thread(shutil.rmtree, root, True)
    await asyncio.to_thread(shutil.rmtree, root.with_name(f"{root.name}.previous"), True)


async def shutdown() -> None:
    for downloads in list(_SERVICES.values()):
        await downloads.shutdown()
