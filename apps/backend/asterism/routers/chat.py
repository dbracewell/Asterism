from fastapi import APIRouter, HTTPException, status

from asterism.internal.db import DBSessionDep
from asterism.repositories.chat_repository import ChatRepository
from asterism.routers.base import JwtSecurityToken
from asterism.routers.typedefs import ErrorDetail
from asterism.schemas.chat import NewSessionResponse
from asterism.utils.security import verify_jwks_token

chat_router = APIRouter(
    prefix="/api/chat",
    tags=["files"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@chat_router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
    operation_id="newChatSession",
    responses={
        201: {"model": NewSessionResponse},
        401: {"model": ErrorDetail},
    },
)
async def new_session(
    credentials: JwtSecurityToken,
    session: DBSessionDep,
) -> NewSessionResponse:
    try:
        user_id = verify_jwks_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")

    repo = ChatRepository(session)
    new_session = await repo.create_new_session(user_id)

    return NewSessionResponse(id=new_session.id)
