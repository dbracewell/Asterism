"""Admin-only HTTP surface for moving application settings."""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from .documents import SettingsEnvelope
from .export import export_settings
from .importer import import_settings, preview_settings
from .schemas import SettingsExportRequest, SettingsImportRequest, SettingsImportSummary

settings_transfer_router = APIRouter(
    prefix="/settings/app/transfer",
    tags=["settings"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 409: {"model": ErrorDetail}},
)


@settings_transfer_router.post("/export", response_model=SettingsEnvelope, operation_id="appSettingsExport")
async def create_settings_export(
    payload: SettingsExportRequest, user: AdminUserDep, session: DBSessionDep
) -> SettingsEnvelope:
    """Build an encrypted file of every application setting. Nothing is stored."""
    return await export_settings(admin_id=user.id, passphrase=payload.passphrase.get_secret_value(), session=session)


@settings_transfer_router.post(
    "/preview", response_model=SettingsImportSummary, operation_id="appSettingsImportPreview"
)
async def create_settings_preview(
    payload: SettingsImportRequest, user: AdminUserDep, session: DBSessionDep
) -> SettingsImportSummary:
    """Say what importing a file would change. Nothing is stored or changed."""
    return await preview_settings(
        source=payload.source, passphrase=payload.passphrase.get_secret_value(), session=session
    )


@settings_transfer_router.post("/import", response_model=SettingsImportSummary, operation_id="appSettingsImport")
async def create_settings_import(
    payload: SettingsImportRequest, user: AdminUserDep, session: DBSessionDep
) -> SettingsImportSummary:
    """Merge a file into this instance, or change nothing if any part fails."""
    return await import_settings(
        admin_id=user.id, source=payload.source, passphrase=payload.passphrase.get_secret_value(), session=session
    )
