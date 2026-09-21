from typing import Annotated

from fastapi import Depends

from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import AuthedUser
from asterism.core.security import DependsJwtToken, optional_auth
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user import service as user_service


async def get_current_user(
    authed_user: DependsJwtToken,
    session: DBSessionDep,
) -> AuthedUser:
    """
    Ensure the user exists in the database and return the authenticated user.

    args:
        authed_user: The authenticated user obtained from the JWT token.
        session: The database session for performing database operations.
    returns:
        The authenticated user.
    """
    await user_service.ensure_user(
        user_id=authed_user.id,
        session=session,
    )
    return authed_user


type AuthedUserDep = Annotated[AuthedUser, Depends(get_current_user)]


async def get_current_admin(
    authed_user: AuthedUserDep,
) -> AuthedUser:
    """
    Ensure the user is an admin and return the authenticated user.

    args:
        authed_user: The authenticated user obtained from the JWT token.
    returns:
        The authenticated user.
    """

    if authed_user.role != "admin":
        raise UnauthorizedException()
    return authed_user


type AdminUserDep = Annotated[AuthedUser, Depends(get_current_admin)]


type OptionalAuthedUser = Annotated[AuthedUser | None, Depends(optional_auth)]
