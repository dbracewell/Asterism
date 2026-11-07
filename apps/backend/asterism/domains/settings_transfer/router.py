"""Admin-only HTTP surface for moving application settings."""

from fastapi import APIRouter

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from .documents import SettingsEnvelope
from .export import export_settings
from .schemas import SettingsExportRequest

settings_transfer_router = APIRouter(
    prefix="/settings/app/transfer",
    tags=["settings"],
    responses={401: {"model": ErrorDetail}},
)


@settings_transfer_router.post("/export", response_model=SettingsEnvelope, operation_id="appSettingsExport")
async def create_settings_export(
    payload: SettingsExportRequest, user: AdminUserDep, session: DBSessionDep
) -> SettingsEnvelope:
    """Build an encrypted file of every application setting. Nothing is stored."""
    return await export_settings(admin_id=user.id, passphrase=payload.passphrase.get_secret_value(), session=session)
