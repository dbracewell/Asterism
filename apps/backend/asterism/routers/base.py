from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from asterism.utils.security import AuthTokenError, verify_jwks_token

security = HTTPBearer(auto_error=False)


def require_auth(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(security),
    ],
) -> str:
    if not credentials:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        return verify_jwks_token(credentials.credentials)
    except AuthTokenError as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc


type AuthenticatedUserId = Annotated[str, Depends(require_auth)]
