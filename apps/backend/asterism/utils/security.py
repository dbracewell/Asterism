from dataclasses import dataclass

import jwt

from asterism.config import config

jwks_client = jwt.PyJWKClient(
    config.JWKS_URL,
    cache_keys=True,
    cache_jwk_set=True,
    lifespan=3600,
)


class AuthTokenError(Exception):
    pass


@dataclass(frozen=True)
class AuthClaims:
    sub: str
    email: str | None = None
    name: str | None = None


def verify_jwks_token(token: str) -> AuthClaims:
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
        user_id = payload.get("sub")
        if not user_id:
            raise AuthTokenError("Missing token subject")

        return AuthClaims(
            sub=str(user_id),
            email=payload.get("email"),
            name=payload.get("name"),
        )
    except jwt.PyJWTError as exc:
        raise AuthTokenError("Invalid token") from exc
