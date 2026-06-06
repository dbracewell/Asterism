from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

security = HTTPBearer()

type JwtSecurityToken = Annotated[
    HTTPAuthorizationCredentials,
    Depends(security),
]
