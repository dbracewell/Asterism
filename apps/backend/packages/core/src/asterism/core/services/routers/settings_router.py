from fastapi import APIRouter
from pydantic import JsonValue

from asterism.core.exceptions import ErrorDetail, UnauthorizedException
from asterism.core.models.app_settings import ApplicationSettingsModel
from asterism.core.models.user_settings import UserSettingsModel
from asterism.core.repositories import settings_repository
from asterism.core.services.dependencies import AuthedUserDep, DBSessionDep
from asterism.core.services.schemas.settings import (
    Setting,
    UpdateSettingValue,
)

settings_router = APIRouter(
    prefix="/settings",
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@settings_router.get(
    "/user",
    response_model=UserSettingsModel,
    operation_id="userSettingsGet",
    summary="Get all user settings",
)
async def get_user_settings(
    user: AuthedUserDep,
    session: DBSessionDep,
) -> UserSettingsModel:
    return await settings_repository.get_user_settings(
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
    return await settings_repository.upsert_user_setting(
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
    await settings_repository.delete_user_setting(
        user_id=user.id,
        key=key,
        session=session,
    )


@settings_router.patch(
    "/user",
    response_model=UserSettingsModel,
    operation_id="userSettingsBulkUpdate",
    summary="Bulk update multiple user settings",
)
async def bulk_update_user_settings(
    updates: dict[str, JsonValue],
    user: AuthedUserDep,
    session: DBSessionDep,
) -> UserSettingsModel:
    return await settings_repository.bulk_upsert_user_settings(
        user_id=user.id,
        updates=updates,
        session=session,
    )


# ---------------------------------------------------------------------------
# Application settings (admin only)
# ---------------------------------------------------------------------------


@settings_router.get(
    "/app",
    response_model=ApplicationSettingsModel,
    operation_id="appSettingsGet",
    summary="Get all application settings",
)
async def get_app_settings(
    user: AuthedUserDep,
    session: DBSessionDep,
) -> ApplicationSettingsModel:
    if user.role != "admin":
        raise UnauthorizedException("Admin access required for application settings")
    return await settings_repository.get_app_settings(session=session)


@settings_router.put(
    "/app/{key}",
    response_model=Setting,
    operation_id="appSettingUpdate",
    summary="Update a single application setting by key",
)
async def update_app_setting(
    key: str,
    value: UpdateSettingValue,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> Setting:
    if user.role != "admin":
        raise UnauthorizedException("Admin access required for application settings")
    return await settings_repository.upsert_app_setting(
        key=key,
        value=value.value,
        updated_by=user.id,
        session=session,
    )


@settings_router.delete(
    "/app/{key}",
    operation_id="appSettingDelete",
    summary="Delete a single application setting by key",
)
async def delete_app_setting(
    key: str,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> None:
    if user.role != "admin":
        raise UnauthorizedException("Admin access required for application settings")
    await settings_repository.delete_app_setting(
        key,
        session=session,
    )


@settings_router.patch(
    "/app",
    response_model=ApplicationSettingsModel,
    operation_id="appSettingsBulkUpdate",
    summary="Bulk update multiple application settings",
)
async def bulk_update_app_settings(
    updates: dict[str, JsonValue],
    user: AuthedUserDep,
    session: DBSessionDep,
) -> ApplicationSettingsModel:
    if user.role != "admin":
        raise UnauthorizedException("Admin access required for application settings")
    return await settings_repository.bulk_update_app_setting(
        updates=updates,
        updated_by=user.id,
        session=session,
    )
