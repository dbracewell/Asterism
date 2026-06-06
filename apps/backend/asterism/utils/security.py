import jwt

from asterism.config import config

jwks_client = jwt.PyJWKClient(
    config.JWKS_URL,
    cache_keys=True,
    cache_jwk_set=True,
    lifespan=3600,
)


def verify_jwks_token(token: str) -> str:
    """Verifies the token using Better Auth's public keys."""
    try:
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=config.FRONT_END_URL,
            issuer=config.FRONT_END_URL,
        )
        user_id = payload.get("sub")
        if not user_id:
            raise Exception("Invalid token payload")
        return user_id
    except jwt.ExpiredSignatureError:
        print("Token expired")
        raise Exception("Token expired")
