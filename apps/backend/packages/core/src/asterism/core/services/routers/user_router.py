from fastapi import APIRouter

from asterism.core.config import config
from asterism.core.data.models.user import CreateUserRequest
from asterism.core.data.repositories import user_repository
from asterism.core.data.schemas import ErrorDetail
from asterism.core.data.schemas.settings import (
    Setting,
)
from asterism.core.exceptions import UnauthorizedException
from asterism.core.services.dependencies import AuthedUserDep, DBSessionDep
from asterism.core.services.dependencies.auth import OptionalAuthedUser

user_router = APIRouter(
    prefix="/users",
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@user_router.post(
    "/",
    response_model=bool,
    operation_id="userCreateUser",
)
async def create_user(
    payload: CreateUserRequest,
    user: OptionalAuthedUser,
    session: DBSessionDep,
) -> Setting:
    print(user)
    can_add = (user and user.role == "admin") or (
        payload.system_key and payload.system_key == config.SYSTEM_KEY
    )
    if not can_add:
        raise UnauthorizedException()
    return await user_repository.create_user(
        user_id=payload.user_id,
        session=session,
    )


@user_router.delete(
    "/{user_id}",
    operation_id="userSettingDelete",
    summary="Delete a single user setting by key",
)
async def delete_user_setting(
    user_id: str,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> None:
    if user.role != "admin":
        raise UnauthorizedException()
    return await user_repository.delete_user(
        user_id=user_id,
        session=session,
    )
