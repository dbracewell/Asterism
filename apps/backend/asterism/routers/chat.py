from fastapi import APIRouter, status

from asterism.internal.db import DBSessionDep
from asterism.repositories.chat_repository import ChatRepository
from asterism.routers.base import AuthenticatedUserId
from asterism.routers.typedefs import ErrorDetail
from asterism.schemas.chat import ChatSessionList, NewSessionResponse

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
    user_id: AuthenticatedUserId,
    session: DBSessionDep,
) -> NewSessionResponse:
    repo = ChatRepository(session)
    new_session = await repo.create_new_session(user_id)

    return NewSessionResponse(
        id=new_session.id,
        title=new_session.title or "New Session",
    )


@chat_router.get(
    "/list",
    status_code=status.HTTP_200_OK,
    operation_id="newChatSession",
    responses={
        200: {"model": ChatSessionList},
        401: {"model": ErrorDetail},
    },
)
async def list_sessions(
    user_id: AuthenticatedUserId,
    session: DBSessionDep,
) -> ChatSessionList:
    repo = ChatRepository(session)
    return await repo.list_chat_sessions(user_id)
