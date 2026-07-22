import asyncio
import json
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from asterism.core.data.models import (
    ChatSessionInfoList,
    ChatSessionModel,
    ChatSessionUpdate,
    NewChatSessionRequest,
)
from asterism.core.data.repositories import chat_repository
from asterism.core.data.schemas import ErrorDetail
from asterism.core.exceptions import UnauthorizedException
from asterism.core.llm.chat import generate
from asterism.core.services.dependencies import (
    AuthedUserDep,
    DBSessionDep,
    verify_jwks_token,
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
        user_id=user.id,
        session_id=chat_id,
        session=session,
    )

    if not chat_session:
        await websocket.close(code=1008, reason="Not Found")
        return

    await websocket.accept()
    try:
        while True:
            raw_data = await websocket.receive_text()
            message_data = json.loads(raw_data)
            user_prompt = message_data.get("message", "")

            queue = asyncio.Queue()
            asyncio.create_task(
                generate(
                    chat_session=chat_session,
                    prompt=user_prompt,
                    session=session,
                    queue=queue,
                )
            )
            await websocket.send_json({"type": "STREAM_START"})
            while True:
                msg = await queue.get()
                await websocket.send_json(msg)
                if msg["type"] == "STREAM_END":
                    break

    except WebSocketDisconnect:
        print("Chat stream disconnected for session")
    except Exception as e:
        print(e)
        await websocket.send_json({"type": "error", "message": str(e)})


@chat_router.post(
    "/",
    response_model=ChatSessionModel,
    operation_id="chatSessionCreate",
)
async def new_session(
    payload: NewChatSessionRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatSessionModel:
    return await chat_repository.create(
        user_id=user.id, folder_id=payload.folder_id, session=db
    )


@chat_router.get(
    "/",
    operation_id="chatSessionGetMany",
)
async def list_sessions(
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatSessionInfoList:
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
) -> ChatSessionModel:
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
    update: ChatSessionUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatSessionModel:
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
) -> ChatSessionModel:
    return await chat_repository.get_one(
        user_id=user.id,
        session_id=session_id,
        session=db,
    )
