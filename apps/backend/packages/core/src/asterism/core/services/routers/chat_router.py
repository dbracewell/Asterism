import uuid

from fastapi import APIRouter, Query, WebSocket

from asterism.core.exceptions import ErrorDetail, UnauthorizedException
from asterism.core.llm import WebSocketChatConnection
from asterism.core.models import ChatModel, ChatModelList
from asterism.core.repositories import chat_repository
from asterism.core.services.dependencies import (
    AuthedUserDep,
    DBSessionDep,
    verify_jwks_token,
)
from asterism.core.services.schemas import (
    ChatUpdateRequest,
    NewChatRequest,
)

chat_router = APIRouter(
    prefix="/chat",
    tags=["files"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@chat_router.websocket("/stream/{chat_id}")
async def chat(
    websocket: WebSocket,
    chat_id: uuid.UUID,
    session: DBSessionDep,
    token: str = Query(...),
):
    try:
        user = verify_jwks_token(token)
    except UnauthorizedException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    chat_session = await chat_repository.get_one(
        session_id=chat_id,
        user_id=user.id,
    )
    websocket_connection = WebSocketChatConnection(
        db_session=session,
        websocket=websocket,
        chat_session=chat_session,
        user=user,
    )
    await websocket_connection.open()


@chat_router.post(
    "/",
    response_model=ChatModel,
    operation_id="chatSessionCreate",
)
async def new_session(
    payload: NewChatRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatModel:
    return await chat_repository.create(
        user_id=user.id,
        model=payload.model,
        user_prompt=payload.user_prompt,
        folder_id=payload.folder_id,
        session=db,
    )


@chat_router.get(
    "/",
    operation_id="chatSessionGetMany",
    response_model=ChatModelList,
)
async def list_sessions(
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatModelList:
    return await chat_repository.get_many(
        user_id=user.id,
        session=db,
    )


@chat_router.post(
    "/{session_id}",
    operation_id="chatSessionDelete",
)
async def delete_session(
    session_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatModel:
    return await chat_repository.delete(
        user_id=user.id,
        session_id=session_id,
        session=db,
    )


@chat_router.put(
    "/{session_id}",
    operation_id="chatSessionUpdate",
)
async def update_session(
    session_id: uuid.UUID,
    update: ChatUpdateRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatModel:
    return await chat_repository.update(
        user_id=user.id,
        session_id=session_id,
        update=update,
        session=db,
    )


@chat_router.get(
    "/{session_id}",
    operation_id="chatSessionGetOne",
)
async def get_session(
    session_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatModel:
    return await chat_repository.get_one(
        user_id=user.id,
        session_id=session_id,
        session=db,
    )
