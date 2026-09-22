from fastapi import APIRouter, HTTPException
from pydantic import JsonValue

import asterism.domains.settings.service as settings_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.knowledge.captioning import CaptionModelStatus
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from .discovery import (
    OpenAIProviderDiscovery,
    ProviderDiscoveryError,
    ProviderDiscoveryRequest,
    ProviderDiscoveryResponse,
)
from .schemas import (
    ApplicationSettings,
    BulkUpdateSettingRequest,
    Setting,
    UpdateSettingValue,
    UserSettings,
)

provider_discovery = OpenAIProviderDiscovery()

settings_router = APIRouter(
    prefix="/settings",
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@settings_router.get(
    "/user",
    response_model=UserSettings,
    operation_id="userSettingsGet",
    summary="Get all user settings",
)
async def get_user_settings(
    user: AuthedUserDep,
    session: DBSessionDep,
) -> UserSettings:
    return await settings_service.get_user_settings(
        user_id=user.id,
        session=session,
    )


@settings_router.put(
    "/user/{key}",
    response_model=Setting,
    operation_id="userSettingUpdate",
    summary="Update a single user setting by key",
)
async def update_user_setting(
    key: str,
    value: UpdateSettingValue,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> Setting:
    return await settings_service.upsert_user_setting(
        user_id=user.id,
        key=key,
        value=value.value,
        session=session,
    )


@settings_router.delete(
    "/user/{key}",
    operation_id="userSettingDelete",
    summary="Delete a single user setting by key",
)
async def delete_user_setting(
    key: str,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> None:
    await settings_service.delete_user_setting(
        user_id=user.id,
        key=key,
        session=session,
    )


@settings_router.patch(
    "/user",
    response_model=UserSettings,
    operation_id="userSettingsBulkUpdate",
    summary="Bulk update multiple user settings",
)
async def bulk_update_user_settings(
    updates: dict[str, JsonValue],
    user: AuthedUserDep,
    session: DBSessionDep,
) -> UserSettings:
    return await settings_service.bulk_upsert_user_settings(
        user_id=user.id,
        updates=updates,
        session=session,
    )


# ---------------------------------------------------------------------------
# Application settings (admin only)
# ---------------------------------------------------------------------------


@settings_router.post(
    "/app/providers/discover",
    response_model=ProviderDiscoveryResponse,
    operation_id="appProviderModelsDiscover",
    summary="Discover provider models and capabilities",
    responses={
        502: {"description": "Provider discovery failed", "model": ErrorDetail},
        504: {"description": "Provider discovery timed out", "model": ErrorDetail},
    },
)
async def discover_provider_models(
    request: ProviderDiscoveryRequest,
    user: AdminUserDep,
) -> ProviderDiscoveryResponse:
    try:
        return await provider_discovery.discover(request)
    except ProviderDiscoveryError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=f"{exc.category}: {exc.detail}",
        ) from exc


@settings_router.get(
    "/app",
    response_model=ApplicationSettings,
    operation_id="appSettingsGet",
    summary="Get all application settings",
)
async def get_app_settings(
    user: AdminUserDep,
    session: DBSessionDep,
) -> ApplicationSettings:
    return await settings_service.get_app_settings(session=session)


@settings_router.put(
    "/app/{key}",
    response_model=Setting,
    operation_id="appSettingUpdate",
    summary="Update a single application setting by key",
)
async def update_app_setting(
    key: str,
    value: UpdateSettingValue,
    user: AdminUserDep,
    session: DBSessionDep,
) -> Setting:
    return await settings_service.upsert_app_setting(
        key=key,
        value=value.value,
        session=session,
    )


@settings_router.delete(
    "/app/{key}",
    operation_id="appSettingDelete",
    summary="Delete a single application setting by key",
)
async def delete_app_setting(
    key: str,
    user: AdminUserDep,
    session: DBSessionDep,
) -> None:
    await settings_service.delete_app_setting(
        key,
        session=session,
    )


@settings_router.patch(
    "/app",
    response_model=ApplicationSettings,
    operation_id="appSettingsBulkUpdate",
    summary="Bulk update multiple application settings",
)
async def bulk_update_app_settings(
    updates: BulkUpdateSettingRequest,
    user: AdminUserDep,
    session: DBSessionDep,
) -> ApplicationSettings:
    return await settings_service.bulk_update_app_setting(
        updates=updates,
        session=session,
    )


# ---------------------------------------------------------------------------
# Local caption model download (admin only)
# ---------------------------------------------------------------------------


@settings_router.get(
    "/app/caption-model/status",
    response_model=dict,
    response_model=CaptionModelStatus,
    operation_id="appCaptionModelStatus",
    summary="Get local caption model download/readiness status",
)
async def get_caption_model_status(
    user: AdminUserDep,
) -> dict:
) -> CaptionModelStatus:
    from asterism.domains.knowledge.runtime import caption_model_download

    status = caption_model_download.status()
    return _caption_model_status_dict(status)
    return caption_model_download.status()


@settings_router.post(
    "/app/caption-model/download",
    response_model=dict,
    response_model=CaptionModelStatus,
    operation_id="appCaptionModelDownload",
    summary="Start downloading the local caption model",
    status_code=202,
    responses={
        409: {"description": "Download already in progress", "model": ErrorDetail},
    },
)
async def start_caption_model_download(
    user: AdminUserDep,
) -> dict:
) -> CaptionModelStatus:
    from asterism.domains.knowledge.runtime import caption_model_download

    try:
        status = await caption_model_download.start_download()
        return await caption_model_download.start_download()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _caption_model_status_dict(status)


@settings_router.post(
    "/app/caption-model/cancel",
    response_model=dict,
    response_model=CaptionModelStatus,
    operation_id="appCaptionModelCancel",
    summary="Cancel an active local caption model download",
)
async def cancel_caption_model_download(
    user: AdminUserDep,
) -> dict:
) -> CaptionModelStatus:
    from asterism.domains.knowledge.runtime import caption_model_download

    status = await caption_model_download.cancel_download()
    return _caption_model_status_dict(status)


def _caption_model_status_dict(status: object) -> dict:
    """Convert a CaptionModelStatus to a plain dict for the JSON response."""
    from dataclasses import asdict

    from asterism.domains.knowledge.captioning import CaptionModelStatus

    if isinstance(status, CaptionModelStatus):
        return asdict(status)
    return {}
    return await caption_model_download.cancel_download()
