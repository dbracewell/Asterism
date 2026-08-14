from typing import Annotated

from fastapi import Depends

from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.core.security import DepenndsJwtToken, optional_auth
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user import service as user_service


async def get_current_user(
    authed_user: DepenndsJwtToken,
    session: DBSessionDep,
):

    await user_service.ensure_user(
        user_id=authed_user.id,
        session=session,
    )
    return authed_user


type AuthedUserDep = Annotated[AuthedUser, Depends(get_current_user)]


async def get_current_admin(
    authed_user: AuthedUserDep,
):
    if authed_user.role != "admin":
        raise UnauthorizedException()
    return authed_user


type AdminUserDep = Annotated[AuthedUser, Depends(get_current_admin)]


type OptionalAuthedUser = Annotated[AuthedUser | None, Depends(optional_auth)]
