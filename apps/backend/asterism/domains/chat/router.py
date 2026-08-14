import uuid

from fastapi import APIRouter, Query, WebSocket

import asterism.domains.chat.service as chat_service
import asterism.domains.settings.service as settings_service
from asterism.core.exceptions import BadDataException, UnauthorizedException
from asterism.core.schemas import ErrorDetail
from asterism.core.security import verify_jwks_token
from asterism.db.dependencies import DBSessionDep
from asterism.domains.agent.agent import Agent
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import (
    Chat,
    ChatInfoList,
    ChatUpdateRequest,
    NewChatRequest,
)
from .websocket import AgentRunnerWebsocket

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
) -> None:
    try:
        user = verify_jwks_token(token)
    except UnauthorizedException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    chat_session = await chat_service.get_one(
        chat_id=chat_id,
        user_id=user.id,
        session=session,
    )
    user_settings = await settings_service.get_user_settings(
        user_id=user.id,
        session=session,
    )

    agent_profile = user_settings.default_agent_profile
    if agent_profile is None:
        raise BadDataException("User does not have a default agent profile set.")

    agent: Agent = Agent(profile=agent_profile, user=user)
    websocket_connection = AgentRunnerWebsocket(
        chat_session=chat_session,
        websocket=websocket,
        agent=agent,
    )
    await websocket_connection.open()


@chat_router.post(
    "/",
    response_model=Chat,
    operation_id="chatSessionCreate",
)
async def new_session(
    payload: NewChatRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Chat:
    return await chat_service.create_chat(
        user_id=user.id,
        payload=payload,
        session=db,
    )


@chat_router.get(
    "/",
    operation_id="chatSessionGetMany",
    response_model=ChatInfoList,
)
async def list_sessions(
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatInfoList:
    return await chat_service.get_many(
        user_id=user.id,
        session=db,
    )


@chat_router.delete(
    "/{chat_id}",
    operation_id="chatSessionDelete",
    response_model=Chat,
)
async def delete_session(
    chat_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Chat:
    return await chat_service.delete_chat(
        user_id=user.id,
        chat_id=chat_id,
        session=db,
    )


@chat_router.patch(
    "/{chat_id}",
    operation_id="chatSessionUpdate",
    response_model=Chat,
)
async def update_session(
    chat_id: uuid.UUID,
    update: ChatUpdateRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Chat:
    return await chat_service.update_chat(
        user_id=user.id,
        chat_id=chat_id,
        payload=update,
        session=db,
    )


@chat_router.get(
    "/{chat_id}",
    operation_id="chatSessionGetOne",
    response_model=Chat,
)
async def get_session(
    chat_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Chat:
    return await chat_service.get_one(
        user_id=user.id,
        chat_id=chat_id,
        session=db,
    )
