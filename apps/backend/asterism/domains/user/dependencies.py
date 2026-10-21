"""FastAPI dependencies that resolve the authenticated principal.

These wrap the raw JWT verification from :mod:`asterism.core.security` with a
database guarantee: by the time a route receives an ``AuthedUserDep`` or
``AdminUserDep``, the user row (and its provisioned main-agent configuration)
is known to exist in Asterism's database.
"""

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
    """Ensure the user exists in the database and return the authenticated user.

    Runs :func:`asterism.domains.user.service.ensure_user`, which is a no-op
    after the first successful call per process (TTL-cached), so steady-state
    requests pay only a dict lookup. A valid JWT for an unknown id therefore
    auto-provisions the user row and main-agent configuration on first sight.

    Args:
        authed_user: The authenticated user obtained from the JWT token.
        session: The database session for performing database operations.

    Returns:
        The authenticated user, guaranteed to have a row in ``users``.
    """
    await user_service.ensure_user(
        user_id=authed_user.id,
        session=session,
    )
    return authed_user


# An authenticated user whose row is guaranteed to exist (see get_current_user).
type AuthedUserDep = Annotated[AuthedUser, Depends(get_current_user)]


async def get_current_admin(
    authed_user: AuthedUserDep,
) -> AuthedUser:
    """Ensure the user is an admin and return the authenticated user.

    The role comes from the verified JWT claim (see
    :mod:`asterism.core.security`); nothing about roles is stored in this
    service's database.

    Args:
        authed_user: The authenticated, DB-verified user from get_current_user.

    Returns:
        The authenticated admin user.

    Raises:
        UnauthorizedException: If the user's role is not "admin".
    """
    if authed_user.role != "admin":
        raise UnauthorizedException()
    return authed_user


# An admin user whose row is guaranteed to exist (see get_current_admin).
type AdminUserDep = Annotated[AuthedUser, Depends(get_current_admin)]


# A user when a valid token was presented, or None otherwise. Unlike
# AuthedUserDep this does not touch the database and accepts no-credential
# requests, which lets routes combine it with alternative auth (e.g. the
# system key on POST /users/).
type OptionalAuthedUser = Annotated[AuthedUser | None, Depends(optional_auth)]
