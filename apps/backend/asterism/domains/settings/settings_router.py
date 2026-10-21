"""FastAPI routes for all settings surfaces under ``/settings``.

Route groups: user settings (any authenticated user), application/provider/tool
settings (admin only), and the generic application-setting key routes. More
specific paths are declared before the generic ``/app/{key}`` routes so
FastAPI's first-match ordering resolves them correctly.

The knowledge administration surfaces (captioning configuration, the processing
profile, and the model-bundle download controls) are served by the knowledge
domain's own router at the same URLs; see
:mod:`asterism.domains.knowledge.router`.
"""

import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import JsonValue

import asterism.domains.settings.service as settings_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.agent.schemas import MainAgentConfiguration, MainAgentUpdate
from asterism.domains.agent.service import get_main_agent, update_main_agent
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
    Llm,
    LlmDisplayInfo,
    ProviderModelsPage,
    ProviderModelUpdate,
    ProviderSettings,
    ProviderSummary,
    Setting,
    ToolSettings,
    UpdateSettingValue,
    UserSettings,
)

# Stateless discovery instance shared across requests (clients are created per call).
provider_discovery = OpenAIProviderDiscovery()

settings_router = APIRouter(
    prefix="/settings",
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


def _discovery_http_error(exc: ProviderDiscoveryError) -> HTTPException:
    """Map a categorized discovery failure onto its declared HTTP response."""
    return HTTPException(
        status_code=exc.status_code,
        detail=f"{exc.category}: {exc.detail}",
    )


@settings_router.get("/user/main-agent", response_model=MainAgentConfiguration, operation_id="mainAgentGet")
async def read_main_agent(user: AuthedUserDep, session: DBSessionDep) -> MainAgentConfiguration:
    """Return the caller's main-agent configuration."""
    return await get_main_agent(user.id, session)


@settings_router.put("/user/main-agent", response_model=MainAgentConfiguration, operation_id="mainAgentUpdate")
async def write_main_agent(
    payload: MainAgentUpdate,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> MainAgentConfiguration:
    """Replace the caller's main-agent configuration and return the stored result."""
    return await update_main_agent(user.id, payload, session)


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
    """Return the caller's full settings aggregate."""
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
    """Set one user setting (a ``null`` value deletes it)."""
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
    """Delete one user setting."""
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
    """Apply several user setting updates atomically."""
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
    """Run model discovery against a candidate endpoint without persisting anything."""
    try:
        return await provider_discovery.discover(request)
    except ProviderDiscoveryError as exc:
        raise _discovery_http_error(exc) from exc


@settings_router.get(
    "/app/providers",
    response_model=ProviderSettings,
    operation_id="appProviderSettingsGet",
    summary="Get provider settings",
)
async def get_provider_settings(
    user: AdminUserDep,
    session: DBSessionDep,
) -> ProviderSettings:
    """Return provider summaries plus the selected draft model."""
    return await settings_service.get_provider_settings(session=session)


@settings_router.put(
    "/app/providers",
    response_model=ProviderSettings,
    operation_id="appProviderSettingsUpdate",
    summary="Replace provider settings",
)
async def update_provider_settings(
    settings: ProviderSettings,
    user: AdminUserDep,
    session: DBSessionDep,
) -> ProviderSettings:
    """Replace the full provider list (missing providers are deleted)."""
    return await settings_service.update_provider_settings(
        settings=settings,
        session=session,
    )


@settings_router.get(
    "/app/providers/{provider_id}/models",
    response_model=ProviderModelsPage,
    operation_id="appProviderModelsList",
    summary="Search a provider's models",
)
async def list_provider_models(
    provider_id: uuid.UUID,
    user: AdminUserDep,
    session: DBSessionDep,
    query: str = Query(default="", max_length=100),
    cursor: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=50),
) -> ProviderModelsPage:
    """Return one page of the provider's models, optionally filtered by name substring."""
    return await settings_service.get_provider_models(
        provider_id=provider_id,
        query=query,
        cursor=cursor,
        limit=limit,
        session=session,
    )


@settings_router.put(
    "/app/providers/{provider_id}/models/{model_id}",
    response_model=Llm,
    operation_id="appProviderModelUpdate",
    summary="Update one provider model",
)
async def update_provider_model(
    provider_id: uuid.UUID,
    model_id: uuid.UUID,
    update: ProviderModelUpdate,
    user: AdminUserDep,
    session: DBSessionDep,
) -> Llm:
    """Replace one model's flags and capabilities."""
    return await settings_service.update_provider_model(
        provider_id=provider_id,
        model_id=model_id,
        update=update,
        session=session,
    )


@settings_router.post(
    "/app/providers/{provider_id}/models/discover",
    response_model=ProviderSummary,
    operation_id="appProviderModelsDiscoverAndSync",
    summary="Discover and synchronize a provider's model catalog",
    responses={
        502: {"description": "Provider discovery failed", "model": ErrorDetail},
        504: {"description": "Provider discovery timed out", "model": ErrorDetail},
    },
)
async def discover_and_sync_provider_models(
    provider_id: uuid.UUID,
    user: AdminUserDep,
    session: DBSessionDep,
) -> ProviderSummary:
    """Discover the provider's models and persist the merged catalog."""
    provider = await settings_service.get_provider_for_discovery(provider_id, session)
    try:
        discovery = await provider_discovery.discover(
            ProviderDiscoveryRequest(
                provider_type=provider.provider_type,
                base_url=provider.base_url,
                api_key=provider.api_key,
                provider_id=provider.id,
                existing_models=provider.models,
            ),
        )
    except ProviderDiscoveryError as exc:
        raise _discovery_http_error(exc) from exc

    return await settings_service.replace_provider_models(
        provider_id,
        discovery.models,
        session,
    )


@settings_router.get(
    "/app/providers/captioning-models",
    response_model=list[LlmDisplayInfo],
    operation_id="appCaptioningProviderModelsGet",
    summary="Get active discovered vision models for captioning",
)
async def get_captioning_provider_models(
    user: AdminUserDep,
    session: DBSessionDep,
) -> list[LlmDisplayInfo]:
    """List active vision-capable models eligible for image captioning."""
    return await settings_service.get_captioning_models(session=session)


@settings_router.get(
    "/app/tools",
    response_model=ToolSettings,
    operation_id="appToolSettingsGet",
    summary="Get tool settings",
)
async def get_tool_settings(
    user: AdminUserDep,
    session: DBSessionDep,
) -> ToolSettings:
    """Return enabled tools and component provider selections."""
    return await settings_service.get_tool_settings(session=session)


@settings_router.put(
    "/app/tools",
    response_model=ToolSettings,
    operation_id="appToolSettingsUpdate",
    summary="Replace tool settings",
)
async def update_tool_settings(
    settings: ToolSettings,
    user: AdminUserDep,
    session: DBSessionDep,
) -> ToolSettings:
    """Replace tool settings (component provider parameters are encrypted at rest)."""
    return await settings_service.update_tool_settings(
        settings=settings,
        session=session,
    )


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
    """Return the full application settings aggregate."""
    return await settings_service.get_app_settings(session=session)


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
    """Apply several application setting updates in one transaction."""
    return await settings_service.bulk_update_app_setting(
        updates=updates,
        session=session,
    )


# ---------------------------------------------------------------------------
# Single application setting by key (admin only)
# ---------------------------------------------------------------------------


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
    """Set one application setting by key (a ``null`` value deletes it)."""
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
    """Delete one application setting (required keys cannot be deleted)."""
    await settings_service.delete_app_setting(
        key,
        session=session,
    )
