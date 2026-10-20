from typing import Annotated, Literal

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from asterism.core import config

from .exceptions import UnauthorizedException
from .schemas import AuthedUser

security = HTTPBearer(auto_error=False)

jwks_client = jwt.PyJWKClient(
    config.jwks_url,
    cache_keys=True,
    cache_jwk_set=True,
    lifespan=3600,
    timeout=5,
)


def _require_non_empty_claim(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise UnauthorizedException()
    return value


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
        if not isinstance(payload, dict):
            raise UnauthorizedException()

        raw_id = payload.get("id")
        raw_sub = payload.get("sub")
        if raw_id is not None and raw_sub is not None and raw_id != raw_sub:
            raise UnauthorizedException()

        user_id = _require_non_empty_claim(raw_id if raw_id is not None else raw_sub)
        email = _require_non_empty_claim(payload.get("email"))
        name = _require_non_empty_claim(payload.get("name"))
        role = payload.get("role")
        if role not in ("user", "admin"):
            raise UnauthorizedException()
        role_literal: Literal["user", "admin"] = "admin" if role == "admin" else "user"

        timezone = payload.get("timezone")
        if timezone is not None and not isinstance(timezone, str):
            raise UnauthorizedException()

        return AuthedUser(
            id=user_id,
            email=email,
            name=name,
            role=role_literal,
            timezone=timezone,
        )
    except (jwt.PyJWTError, ValidationError) as exc:
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
