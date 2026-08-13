from fastapi import APIRouter

from asterism.common import ComponentType, ErrorDetail
from asterism.registries import component_registry
from asterism.schemas import ComponentListResponse, ComponentResponse
from asterism.services.dependencies import (
    AuthedUserDep,
)
from asterism.utils.json_schema import inline_refs

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
            )
        )
    return ComponentListResponse(items=items)
