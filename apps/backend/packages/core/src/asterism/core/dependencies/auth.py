from typing import Annotated, Literal, cast

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from asterism.core import config
from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import AuthedUser

security = HTTPBearer(auto_error=False)


jwks_client = jwt.PyJWKClient(
    config.JWKS_URL,
    cache_keys=True,
    cache_jwk_set=True,
    lifespan=3600,
)


def verify_jwks_token(token: str) -> AuthedUser:
    """Verifies a Better Auth JWT using the JWKS endpoint and returns normalized auth claims."""
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.JWT_AUDIENCE,
            issuer=config.JWT_ISSUER,
        )
        user_id = payload.get("id")
        if not user_id:
            raise UnauthorizedException()

        return AuthedUser(
            id=str(user_id),
            email=str(payload.get("email")),
            name=str(payload.get("name")),
            role=cast(Literal["user", "admin"], payload.get("role")),
        )
    except jwt.PyJWTError as exc:
        raise UnauthorizedException() from exc


def require_auth(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(security),
    ],
) -> AuthedUser:
    if not credentials:
        raise UnauthorizedException()
    return verify_jwks_token(credentials.credentials)


type AuthedUserDep = Annotated[AuthedUser, Depends(require_auth)]
