"""Admin endpoints for the local diffusers generator (US-76.2)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from . import downloads
from .availability import NOT_AVAILABLE, local_image_installed
from .catalog import CATALOG, CatalogEntry, entry
from .hardware import HardwareReport, clear_cache, detect
from .planning import Plan, plan, recommend
from .runtime import runtime
from .settings import LocalSettings, read_settings, write_settings

local_image_router = APIRouter(
    prefix="/settings/app/image-generation/local",
    tags=["image-generation"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)
logger = get_logger("ImageGeneration")


class LocalDownload(BaseModel):
    status: Literal["idle", "downloading", "verifying", "ready", "failed"]
    bytes_downloaded: int
    total_bytes: int
    error: str | None = None


class LocalModel(BaseModel):
    id: str
    name: str
    repo: str
    revision: str
    license: str
    commercial_use: bool
    description: str
    disk_gb: float
    memory_gb: float
    plan: Plan
    download: LocalDownload
    license_accepted: bool


class LocalOverview(BaseModel):
    # False in an image without the local-image extra (US-94.2): then there is
    # no hardware report and no catalog, and every change is refused.
    installed: bool
    hardware: HardwareReport | None
    recommended_id: str | None
    settings: LocalSettings
    models: list[LocalModel]
    worker_running: bool


class LocalSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str | None
    device: Literal["auto", "cuda", "mps", "cpu"] = "auto"


class DownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept_license: bool = False


def _require_installed() -> None:
    if not local_image_installed():
        raise BadDataException(NOT_AVAILABLE)


def _known(model_id: str) -> CatalogEntry:
    _require_installed()
    found = entry(model_id)
    if found is None:
        raise NotFoundException("Unknown local model")
    return found


def _download(model: CatalogEntry) -> LocalDownload:
    progress = downloads.service(model).progress()
    return LocalDownload(
        status=progress.status,
        bytes_downloaded=progress.bytes_downloaded,
        total_bytes=progress.total_bytes or int(model.disk_gb * 1e9),
        error=progress.error,
    )


async def _overview(session) -> LocalOverview:
    settings = await read_settings(session)
    if not local_image_installed():
        return LocalOverview(
            installed=False, hardware=None, recommended_id=None, settings=settings, models=[], worker_running=False
        )
    clear_cache()
    hardware = detect(settings.device)
    best = recommend(hardware)
    return LocalOverview(
        installed=True,
        hardware=hardware,
        recommended_id=best.id if best else None,
        settings=settings,
        worker_running=runtime.running is not None,
        models=[
            LocalModel(
                id=model.id,
                name=model.name,
                repo=model.repo,
                revision=model.revision,
                license=model.license,
                commercial_use=model.commercial_use,
                description=model.description,
                disk_gb=model.disk_gb,
                memory_gb=model.memory_gb,
                plan=plan(model, hardware),
                download=_download(model),
                license_accepted=model.commercial_use or model.id in settings.accepted_licenses,
            )
            for model in CATALOG
        ],
    )


@local_image_router.get("", operation_id="localImageOverview")
async def overview(user: AdminUserDep, session: DBSessionDep) -> LocalOverview:
    """Detected hardware, the catalog with fit and download state, and the recommendation.

    Without the local-image extra, only the saved settings, with ``installed`` false.
    """
    return await _overview(session)


@local_image_router.put("", operation_id="localImageSelect")
async def select(payload: LocalSelection, user: AdminUserDep, session: DBSessionDep) -> LocalOverview:
    _require_installed()
    settings = await read_settings(session)
    if payload.model_id is not None:
        _known(payload.model_id)
    await write_settings(settings.model_copy(update=payload.model_dump()), session)
    # A different model or device needs a fresh worker.
    await runtime.stop()
    logger.info(f"Local image model set to {payload.model_id} on {payload.device} by admin {user.id}")
    return await _overview(session)


@local_image_router.post("/models/{model_id}/download", operation_id="localImageDownload")
async def download(model_id: str, payload: DownloadRequest, user: AdminUserDep, session: DBSessionDep) -> LocalOverview:
    """Start downloading a model. A non-commercial license must be accepted first."""
    model = _known(model_id)
    settings = await read_settings(session)
    if not model.commercial_use and model.id not in settings.accepted_licenses:
        if not payload.accept_license:
            raise BadDataException(f"Accept the {model.license} to download {model.name}")
        await write_settings(
            settings.model_copy(update={"accepted_licenses": [*settings.accepted_licenses, model.id]}), session
        )
        logger.info(f"Admin {user.id} accepted the {model.license} for {model.repo}")
    await downloads.service(model).start_download()
    logger.info(f"Admin {user.id} started downloading {model.repo}@{model.revision}")
    return await _overview(session)


@local_image_router.delete("/models/{model_id}/download", operation_id="localImageCancelDownload")
async def cancel(model_id: str, user: AdminUserDep, session: DBSessionDep) -> LocalOverview:
    await downloads.service(_known(model_id)).cancel_download()
    return await _overview(session)


@local_image_router.delete("/models/{model_id}", operation_id="localImageRemove")
async def remove(model_id: str, user: AdminUserDep, session: DBSessionDep) -> LocalOverview:
    """Delete a downloaded model's files to free disk space."""
    model = _known(model_id)
    if runtime.running is not None and runtime.running.model_dir == downloads.model_dir(model):
        await runtime.stop()
    await downloads.remove(model)
    logger.info(f"Admin {user.id} removed local model {model.repo}")
    return await _overview(session)
