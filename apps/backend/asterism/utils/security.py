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


def verify_jwks_token(token: str) -> str:
    """Verifies a Better Auth JWT using the JWKS endpoint and returns the subject user id."""
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
        return str(user_id)
    except jwt.PyJWTError as exc:
        raise AuthTokenError("Invalid token") from exc
