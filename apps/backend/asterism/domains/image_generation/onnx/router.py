"""Admin endpoints for the ONNX generator's models (US-94.4)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from ..local.runtime import runtime
from . import downloads
from .catalog import CATALOG, OnnxCatalogEntry, entry
from .planning import OnnxPlan, plan, recommend, server_ram_gb
from .schemas import OnnxSettings
from .settings import read_settings, write_settings

onnx_image_router = APIRouter(
    prefix="/settings/app/image-generation/onnx",
    tags=["image-generation"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)
logger = get_logger("ImageGeneration")


class OnnxDownload(BaseModel):
    status: Literal["idle", "downloading", "verifying", "ready", "failed"]
    bytes_downloaded: int
    total_bytes: int
    error: str | None = None


class OnnxModel(BaseModel):
    id: str
    name: str
    repo: str
    revision: str
    license: str
    license_url: str
    commercial_use: bool
    attribution: str | None
    description: str
    download_gb: float
    memory_gb: float
    steps: int
    plan: OnnxPlan
    download: OnnxDownload
    license_accepted: bool


class OnnxOverview(BaseModel):
    memory_gb: float
    recommended_id: str | None
    settings: OnnxSettings
    models: list[OnnxModel]
    worker_running: bool


class OnnxSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str | None


class OnnxDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept_license: bool = False


def _known(model_id: str) -> OnnxCatalogEntry:
    found = entry(model_id)
    if found is None:
        raise NotFoundException("Unknown ONNX model")
    return found


def _download(model: OnnxCatalogEntry) -> OnnxDownload:
    progress = downloads.service(model).progress()
    return OnnxDownload(
        status=progress.status,
        bytes_downloaded=progress.bytes_downloaded,
        total_bytes=progress.total_bytes or int(model.download_gb * 1e9),
        error=progress.error,
    )


async def _overview(session) -> OnnxOverview:
    settings = await read_settings(session)
    ram = server_ram_gb()
    best = recommend(ram)
    return OnnxOverview(
        memory_gb=ram,
        recommended_id=best.id if best else None,
        settings=settings,
        worker_running=runtime.running is not None,
        models=[
            OnnxModel(
                id=model.id,
                name=model.name,
                repo=model.repo,
                revision=model.revision,
                license=model.license,
                license_url=model.license_url,
                commercial_use=model.commercial_use,
                attribution=model.attribution,
                description=model.description,
                download_gb=model.download_gb,
                memory_gb=model.memory_gb,
                steps=model.steps,
                plan=plan(model, ram),
                download=_download(model),
                license_accepted=model.commercial_use or model.id in settings.accepted_licenses,
            )
            for model in CATALOG
        ],
    )


@onnx_image_router.get("", operation_id="onnxImageOverview")
async def overview(user: AdminUserDep, session: DBSessionDep) -> OnnxOverview:
    """Server memory, the catalog with fit, licenses and download state, and the recommendation."""
    return await _overview(session)


@onnx_image_router.put("", operation_id="onnxImageSelect")
async def select(payload: OnnxSelection, user: AdminUserDep, session: DBSessionDep) -> OnnxOverview:
    settings = await read_settings(session)
    if payload.model_id is not None:
        _known(payload.model_id)
    await write_settings(settings.model_copy(update=payload.model_dump()), session)
    # A different model needs a fresh worker.
    await runtime.stop()
    logger.info(f"ONNX image model set to {payload.model_id} by admin {user.id}")
    return await _overview(session)


@onnx_image_router.post("/models/{model_id}/download", operation_id="onnxImageDownload")
async def download(
    model_id: str, payload: OnnxDownloadRequest, user: AdminUserDep, session: DBSessionDep
) -> OnnxOverview:
    """Start downloading a model. A license that limits use must be accepted first."""
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


@onnx_image_router.delete("/models/{model_id}/download", operation_id="onnxImageCancelDownload")
async def cancel(model_id: str, user: AdminUserDep, session: DBSessionDep) -> OnnxOverview:
    await downloads.service(_known(model_id)).cancel_download()
    return await _overview(session)


@onnx_image_router.delete("/models/{model_id}", operation_id="onnxImageRemove")
async def remove(model_id: str, user: AdminUserDep, session: DBSessionDep) -> OnnxOverview:
    """Delete a downloaded model's files to free disk space."""
    model = _known(model_id)
    if runtime.running is not None and runtime.running.model_dir == downloads.model_dir(model):
        await runtime.stop()
    await downloads.remove(model)
    logger.info(f"Admin {user.id} removed ONNX model {model.repo}")
    return await _overview(session)
