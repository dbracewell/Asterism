from fastapi import APIRouter

import asterism.domains.user.service as user_service
from asterism.core import config
from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep

from .dependencies import AuthedUserDep, OptionalAuthedUser
from .schemas import CreateUserRequest

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
) -> bool:
    can_add = (user and user.role == "admin") or (
        payload.system_key and payload.system_key == config.system_key
    )
    if not can_add:
        raise UnauthorizedException()
    return await user_service.create_user(
        user_id=payload.user_id,
        session=session,
    )


@user_router.delete(
    "/{user_id}",
    operation_id="userDelete",
    summary="Delete a user",
)
async def delete_user(
    user_id: str,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> bool:
    if user.role != "admin":
        raise UnauthorizedException()
    return await user_service.delete_user(
        user_id=user_id,
        session=session,
    )
