"""Admin endpoints for the ComfyUI generator (US-76.3)."""

from fastapi import APIRouter

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from ..providers import ImageGenerationError
from .client import ComfyUIClient
from .provider import clear_probes
from .schemas import ComfyUIOverview, ComfyUISettings, ComfyUISettingsUpdate, ComfyUITestResult
from .settings import merge, read_settings, view, write_settings
from .workflow import DEFAULT_WORKFLOW, PLACEHOLDERS, check_workflow

comfyui_router = APIRouter(
    prefix="/settings/app/image-generation/comfyui",
    tags=["image-generation"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}},
)
logger = get_logger("ComfyUI")


def _overview(settings: ComfyUISettings) -> ComfyUIOverview:
    return ComfyUIOverview(settings=view(settings), default_workflow=DEFAULT_WORKFLOW, placeholders=list(PLACEHOLDERS))


@comfyui_router.get("", operation_id="comfyuiSettingsGet")
async def get_settings(user: AdminUserDep, session: DBSessionDep) -> ComfyUIOverview:
    """The server, auth (the token is never returned), workflow and limits."""
    return _overview(await read_settings(session))


@comfyui_router.put("", operation_id="comfyuiSettingsUpdate")
async def put_settings(payload: ComfyUISettingsUpdate, user: AdminUserDep, session: DBSessionDep) -> ComfyUIOverview:
    if payload.workflow is not None:
        try:
            check_workflow(payload.workflow)
        except ValueError as error:
            raise BadDataException(str(error)) from error
    saved = await write_settings(merge(payload, await read_settings(session)), session)
    clear_probes()
    logger.info(
        f"ComfyUI settings set by admin {user.id}: {saved.base_url} auth={saved.auth} "
        f"workflow={'custom' if saved.workflow else 'built-in'}"
    )
    return _overview(saved)


@comfyui_router.post("/test", operation_id="comfyuiTestConnection")
async def test_connection(
    payload: ComfyUISettingsUpdate, user: AdminUserDep, session: DBSessionDep
) -> ComfyUITestResult:
    """Try these settings (unsaved; a missing token uses the stored one) and list checkpoints."""
    settings = merge(payload, await read_settings(session))
    if not settings.base_url:
        return ComfyUITestResult(ok=False, detail="Enter the ComfyUI server address")
    try:
        async with ComfyUIClient(settings) as client:
            stats = await client.system_stats()
            checkpoints = await client.checkpoints()
    except ImageGenerationError as error:
        return ComfyUITestResult(ok=False, detail=str(error))
    system = stats.get("system") or {}
    devices = [str(device.get("name", "?")) for device in stats.get("devices") or [] if isinstance(device, dict)]
    version = system.get("comfyui_version")
    detail = f"Connected to ComfyUI {version}" if version else "Connected to ComfyUI"
    if settings.workflow is None and settings.checkpoint and settings.checkpoint not in checkpoints:
        return ComfyUITestResult(
            ok=False,
            detail=f"{detail}, but it has no checkpoint named {settings.checkpoint}",
            version=version,
            devices=devices,
            checkpoints=checkpoints,
        )
    return ComfyUITestResult(ok=True, detail=detail, version=version, devices=devices, checkpoints=checkpoints)
