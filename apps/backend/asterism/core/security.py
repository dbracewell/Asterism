"""JWT authentication for backend API routes.

Tokens are issued by the frontend's BetterAuth instance and verified here
against its JWKS endpoint (RS256, with issuer/audience pinned to the public URL).
FastAPI dependencies expose the resolved :class:`AuthedUser` to route handlers.
"""

from typing import Annotated, Literal

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from asterism.core import config

from .exceptions import UnauthorizedException
from .schemas import AuthedUser

# Bearer scheme that returns None (instead of a 403) when no header is present,
# so callers can decide between "unauthenticated" and "invalid token".
security = HTTPBearer(auto_error=False)

jwks_client = jwt.PyJWKClient(
    config.jwks_url,
    cache_keys=True,
    cache_jwk_set=True,
    lifespan=3600,
    timeout=5,
)


def _require_non_empty_claim(value: object) -> str:
    """Coerce a JWT claim to a non-empty string.

    Args:
        value: The raw claim value from the decoded token payload.

    Raises:
        UnauthorizedException: If the claim is missing, not a string, or blank.
    """
    if not isinstance(value, str) or not value.strip():
        raise UnauthorizedException()
    return value


def verify_jwks_token(token: str) -> AuthedUser:
    """Verify a BetterAuth-issued JWT and resolve the authenticated user.

    Checks signature (via JWKS), issuer, audience, and required claims
    (id/sub, email, name, role). The ``id`` and ``sub`` claims must agree when both are present.

    Args:
        token: Raw JWT string from the Authorization header.

    Returns:
        The resolved :class:`AuthedUser`.

    Raises:
        UnauthorizedException: If any part of verification or claim extraction fails.
    """
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.jwt_audience,
            issuer=config.jwt_issuer,
            options={"require": ["exp"]},
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
    """FastAPI dependency requiring a valid bearer token.

    Args:
        credentials: Parsed ``Authorization: Bearer <token>`` header, if present.

    Returns:
        The resolved :class:`AuthedUser`.

    Raises:
        UnauthorizedException: If no credentials are provided or the token is invalid.
    """
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
    """FastAPI dependency accepting an optional bearer token.

    Args:
        credentials: Parsed ``Authorization: Bearer <token>`` header, if present.

    Returns:
        The resolved :class:`AuthedUser`, or None when no token is provided or it is invalid.
    """
    if not credentials:
        return None
    try:
        return verify_jwks_token(credentials.credentials)
    except UnauthorizedException:
        return None
