"""Admin endpoints for groups and membership (ADR-0058)."""

from fastapi import APIRouter, status
from sqlalchemy import func, select

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.tools.catalog import ToolPolicy, tool_policy
from asterism.domains.tools.registry import tool_registry
from asterism.domains.user.dependencies import AdminUserDep

from . import service
from .schemas import (
    Group,
    GroupAccessOptions,
    GroupAccessUpdate,
    GroupCreate,
    GroupMembershipUpdate,
    GroupModelOption,
    GroupRef,
    GroupToolOption,
    GroupUpdate,
)

ERRORS = {
    400: {"model": ErrorDetail},
    401: {"model": ErrorDetail},
    404: {"model": ErrorDetail},
    409: {"model": ErrorDetail},
}

groups_router = APIRouter(prefix="/groups", tags=["settings"], responses=ERRORS)


@groups_router.get("", response_model=list[Group], operation_id="groupGetMany")
async def list_groups(user: AdminUserDep, db: DBSessionDep) -> list[Group]:
    """Every group with its member count; built-in groups first."""
    return await service.list_groups(db)


@groups_router.get("/access-options", response_model=GroupAccessOptions, operation_id="groupAccessOptions")
async def access_options(user: AdminUserDep, db: DBSessionDep) -> GroupAccessOptions:
    """Every shared model and configurable tool a group's lists can name."""
    from asterism.domains.settings.models import LLMModel, ProviderModel
    from asterism.domains.settings.tool_settings import get_tool_settings

    rows = await db.execute(
        select(LLMModel, ProviderModel.name)
        .join(ProviderModel, ProviderModel.id == LLMModel.provider_id)
        .where(ProviderModel.owner_user_id.is_(None))
        .order_by(func.lower(ProviderModel.name), func.lower(func.coalesce(LLMModel.display_name, LLMModel.name)))
    )
    active = set((await get_tool_settings(db)).active_tools)
    return GroupAccessOptions(
        models=[
            GroupModelOption(
                id=model.id, name=model.display_name or model.name, provider_name=provider, enabled=model.is_active
            )
            for model, provider in rows
        ],
        tools=[
            GroupToolOption(name=tool.name, description=tool.description, enabled=tool.name in active)
            for tool in tool_registry.tools().items
            if tool_policy(tool.name) == ToolPolicy.USER_CONFIGURABLE
        ],
    )


@groups_router.post("", response_model=Group, status_code=status.HTTP_201_CREATED, operation_id="groupCreate")
async def create_group(payload: GroupCreate, user: AdminUserDep, db: DBSessionDep) -> Group:
    return await service.create_group(name=payload.name, admin_id=user.id, session=db)


@groups_router.patch("/{group_id}", response_model=Group, operation_id="groupRename")
async def rename_group(group_id: str, payload: GroupUpdate, user: AdminUserDep, db: DBSessionDep) -> Group:
    """Rename a custom group; built-in groups keep their names."""
    return await service.rename_group(group_id=group_id, name=payload.name, admin_id=user.id, session=db)


@groups_router.put("/{group_id}/access", response_model=Group, operation_id="groupAccessUpdate")
async def update_access(group_id: str, payload: GroupAccessUpdate, user: AdminUserDep, db: DBSessionDep) -> Group:
    """Set which shared models and tools members may use. It only narrows what the administrator enabled."""
    configurable = {name for name in tool_registry.registry if tool_policy(name) == ToolPolicy.USER_CONFIGURABLE}
    return await service.set_access(
        group_id=group_id,
        models=payload.models,
        tools=payload.tools,
        configurable_tools=configurable,
        admin_id=user.id,
        session=db,
    )


@groups_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="groupDelete")
async def delete_group(group_id: str, user: AdminUserDep, db: DBSessionDep) -> None:
    """Delete an empty custom group."""
    await service.delete_group(group_id=group_id, admin_id=user.id, session=db)


@groups_router.put("/members/{user_id}", response_model=GroupRef, operation_id="groupMemberMove")
async def move_member(user_id: str, payload: GroupMembershipUpdate, user: AdminUserDep, db: DBSessionDep) -> GroupRef:
    """Move a user into another group. The admin group follows the sign-in role and can't be set here."""
    return await service.move_user(user_id=user_id, group_id=payload.group_id, admin_id=user.id, session=db)
