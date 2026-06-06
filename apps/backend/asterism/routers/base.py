from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from asterism.internal.db import DBSessionDep
from asterism.models.user import User
from asterism.repositories.user_repository import ADMIN_ROLE, UserRepository
from asterism.utils.security import AuthClaims, AuthTokenError, verify_jwks_token

security = HTTPBearer(auto_error=False)


def require_auth(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(security),
    ],
) -> AuthClaims:
    if not credentials:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        return verify_jwks_token(credentials.credentials)
    except AuthTokenError as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc


def get_authenticated_user_id(
    claims: Annotated[AuthClaims, Depends(require_auth)],
) -> str:
    return claims.sub


async def get_current_user(
    claims: Annotated[AuthClaims, Depends(require_auth)],
    session: DBSessionDep,
) -> User:
    user_repo = UserRepository(session)
    return await user_repo.get_or_create_user(
        user_id=claims.sub,
        email=claims.email,
        display_name=claims.name,
    )


async def require_admin(
    user: Annotated[User, Depends(get_current_user)],
    session: DBSessionDep,
) -> User:
    user_repo = UserRepository(session)
    is_admin = await user_repo.has_role(user, ADMIN_ROLE)
    if not is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


type AuthenticatedClaims = Annotated[AuthClaims, Depends(require_auth)]
type AuthenticatedUserId = Annotated[str, Depends(get_authenticated_user_id)]
type CurrentUser = Annotated[User, Depends(get_current_user)]
type CurrentAdminUser = Annotated[User, Depends(require_admin)]
