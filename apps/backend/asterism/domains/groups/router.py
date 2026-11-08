"""Admin endpoints for groups and membership (ADR-0058)."""

from fastapi import APIRouter, status

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AdminUserDep

from . import service
from .schemas import Group, GroupCreate, GroupMembershipUpdate, GroupRef, GroupUpdate

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


@groups_router.post("", response_model=Group, status_code=status.HTTP_201_CREATED, operation_id="groupCreate")
async def create_group(payload: GroupCreate, user: AdminUserDep, db: DBSessionDep) -> Group:
    return await service.create_group(name=payload.name, admin_id=user.id, session=db)


@groups_router.patch("/{group_id}", response_model=Group, operation_id="groupRename")
async def rename_group(group_id: str, payload: GroupUpdate, user: AdminUserDep, db: DBSessionDep) -> Group:
    """Rename a custom group; built-in groups keep their names."""
    return await service.rename_group(group_id=group_id, name=payload.name, admin_id=user.id, session=db)


@groups_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT, operation_id="groupDelete")
async def delete_group(group_id: str, user: AdminUserDep, db: DBSessionDep) -> None:
    """Delete an empty custom group."""
    await service.delete_group(group_id=group_id, admin_id=user.id, session=db)


@groups_router.put("/members/{user_id}", response_model=GroupRef, operation_id="groupMemberMove")
async def move_member(user_id: str, payload: GroupMembershipUpdate, user: AdminUserDep, db: DBSessionDep) -> GroupRef:
    """Move a user into another group. The admin group follows the sign-in role and can't be set here."""
    return await service.move_user(user_id=user_id, group_id=payload.group_id, admin_id=user.id, session=db)
