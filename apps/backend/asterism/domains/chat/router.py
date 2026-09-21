import uuid

from fastapi import APIRouter, Query, WebSocket

import asterism.domains.agent.service as agent_service
import asterism.domains.chat.service as chat_service
from asterism.common.log import get_logger
from asterism.core.exceptions import UnauthorizedException
from asterism.core.schemas import ErrorDetail
from asterism.core.security import verify_jwks_token
from asterism.db.dependencies import DBSessionDep
from asterism.domains.agent.agent import Agent
from asterism.domains.chat.connection import WebSocketConnection
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import (
    BulkDeleteChatRequest,
    BulkDeleteChatResponse,
    Chat,
    ChatInfoList,
    ChatUpdateRequest,
    Message,
    NewChatRequest,
    SearchResultList,
    UpdateMessageRequest,
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
    if chat_session.info.agent_id is None:
        await websocket.close(
            code=1008,
            reason="This legacy chat has no assigned main agent",
        )
        return

    agent: Agent = Agent(
        profile=await agent_service.get_agent_profile(
            user_id=user.id,
            agent_id=chat_session.info.agent_id,
            session=session,
        ),
        user=user,
        session=chat_session,
        logger=get_logger("ChatSession"),
        allowed_tools=chat_session.info.allowed_tools,
    )

    job = chat_jobs.get_or_create(chat_id, ChatOrchestrator(agent))
    controller = ChatController(
        chat_id=chat_id,
        connection=WebSocketConnection(websocket=websocket),
        job=job,
    )

    await controller.run()


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
    "/bulk",
    operation_id="chatSessionBulkDelete",
    response_model=BulkDeleteChatResponse,
)
async def bulk_delete_sessions(
    payload: BulkDeleteChatRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> BulkDeleteChatResponse:
    return await chat_service.delete_chats(
        user_id=user.id,
        chat_ids=payload.chat_ids,
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
    "/search",
    operation_id="chatSearch",
    response_model=SearchResultList,
)
async def search_chats_and_folders(
    q: str,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> SearchResultList:
    return await chat_service.search(
        user_id=user.id,
        query=q,
        page=page,
        page_size=page_size,
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
    chat_session = await chat_service.get_one(
        user_id=user.id,
        chat_id=chat_id,
        session=db,
    )
    if chat_session.info.agent_id is not None:
        agent = Agent(
            profile=await agent_service.get_agent_profile(
                user_id=user.id,
                agent_id=chat_session.info.agent_id,
                session=db,
            ),
            user=user,
            session=chat_session,
            logger=get_logger("ChatSession"),
            allowed_tools=chat_session.info.allowed_tools,
        )
        chat_session.context_usage = await ChatOrchestrator(agent).estimate_context_usage()
    return chat_session


@chat_router.patch(
    "/{chat_id}/message/{message_id}",
    operation_id="messageUpdate",
    response_model=Message,
)
async def update_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: UpdateMessageRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Message:
    return await chat_service.update_message(
        user_id=user.id,
        chat_id=chat_id,
        message_id=message_id,
        payload=payload,
        session=db,
    )
