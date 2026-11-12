from typing import Any

from fastapi import APIRouter
from pydantic import ValidationError

from asterism.common.json_schema import inline_refs
from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep, AuthedUserDep

from .registry import component_registry
from .schemas import ComponentListResponse, ComponentResponse, ComponentTestRequest, ComponentTestResult, ComponentType

logger = get_logger("Components")

components_router = APIRouter(
    tags=["components"],
    prefix="/components",
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@components_router.get(
    "/by_type/{component_type}",
    response_model=ComponentListResponse,
    operation_id="componentsByType",
    summary="Get all components of a given type",
)
def get_components_by_type(
    component_type: ComponentType,
    _: AuthedUserDep,
) -> ComponentListResponse:
    components = component_registry.get_providers(component_type=component_type)
    items: list[ComponentResponse] = []
    for c in components:
        schema = c.parameters.model_json_schema()
        extended_schema = inline_refs(schema)
        items.append(
            ComponentResponse(
                type=component_type,
                name=c.name,
                parameters=extended_schema,
                testable=c.testable(),
            ),
        )
    return ComponentListResponse(items=items)


async def _with_stored_secrets(
    component_type: ComponentType, name: str, parameters: dict[str, Any], session
) -> dict[str, Any]:
    """Replace redacted secrets with the stored ones when this provider is the saved one."""
    from asterism.domains.settings.models import ApplicationSettingsModel
    from asterism.domains.settings.secrets import (
        REDACTED_SECRET,
        decrypt_component_provider_dict,
        is_secret_parameter_key,
    )
    from asterism.domains.settings.tool_settings import COMPONENT_PROVIDER_KEYS

    key = next((key for key, kind in COMPONENT_PROVIDER_KEYS.items() if kind == component_type.value), None)
    row = await session.get(ApplicationSettingsModel, key) if key else None
    stored = decrypt_component_provider_dict(row.value) if row is not None else None
    if not isinstance(stored, dict) or str(stored.get("name", "")).upper() != name.upper():
        return parameters
    saved = stored.get("parameters") or {}
    return {
        field: saved.get(field, "") if is_secret_parameter_key(field) and value == REDACTED_SECRET else value
        for field, value in parameters.items()
    }


@components_router.post(
    "/{component_type}/{name}/test",
    operation_id="componentsTest",
    summary="Check a component's parameters, usually before saving them",
)
async def test_component(
    component_type: ComponentType,
    name: str,
    payload: ComponentTestRequest,
    user: AdminUserDep,
    session: DBSessionDep,
) -> ComponentTestResult:
    component = component_registry.find(component_type, name)
    if component is None:
        raise NotFoundException(f"No {component_type.value} component named {name}")
    if not component.testable():
        raise BadDataException(f"{component.name} can't be tested")
    parameters = await _with_stored_secrets(component_type, name, payload.parameters, session)
    try:
        config = component.parameters.model_validate(parameters)
    except ValidationError as error:
        from asterism.domains.settings.service import validation_message

        return ComponentTestResult(ok=False, detail=validation_message(error))
    try:
        result = await component(config).test()
    except Exception as error:  # noqa: BLE001 - reported to the admin
        logger.warning(f"Testing {component.name} failed: {error}")
        return ComponentTestResult(ok=False, detail=f"The test failed: {error}")
    logger.info(f"Admin {user.id} tested {component.name}: {'ok' if result.ok else result.detail}")
    return result
