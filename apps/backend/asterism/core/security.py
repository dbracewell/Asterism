import ssl
from typing import Annotated, Literal, cast

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from asterism.core import config

from .exceptions import UnauthorizedException
from .schemas import AuthedUser

security = HTTPBearer(auto_error=False)

if config.jwks_url.startswith("https://localhost") or config.jwks_url.startswith(
    "https://127.0.0.1"
):
    ssl_ctx = ssl._create_unverified_context()
else:
    ssl_ctx = ssl.create_default_context()

jwks_client = jwt.PyJWKClient(
    config.jwks_url,
    cache_keys=True,
    cache_jwk_set=True,
    lifespan=3600,
    ssl_context=ssl_ctx,
)


security = HTTPBearer(auto_error=False)


def verify_jwks_token(token: str) -> AuthedUser:
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.jwt_audience,
            issuer=config.jwt_issuer,
        )

        user_id = payload.get("id")
        if not user_id:
            raise UnauthorizedException()

        return AuthedUser(
            id=str(user_id),
            email=str(payload.get("email")),
            name=str(payload.get("name")),
            role=cast(Literal["user", "admin"], payload.get("role")),
            timezone=payload.get("timezone"),
        )
    except jwt.PyJWTError as exc:
        raise UnauthorizedException() from exc


def verify_jwks(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(security),
    ],
) -> AuthedUser:
    if not credentials:
        raise UnauthorizedException()
    return verify_jwks_token(credentials.credentials)


type DependsJwtToken = Annotated[AuthedUser, Depends(verify_jwks)]


def optional_auth(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(security),
    ],
) -> AuthedUser | None:
    if not credentials:
        return None
    try:
        return verify_jwks_token(credentials.credentials)
    except UnauthorizedException:
        return None
