import uuid

from fastapi import APIRouter, Query, WebSocket

from asterism.common import AgentProfile, ErrorDetail, UnauthorizedException
from asterism.llm import Agent
from asterism.repositories import chat_repository, settings_repository
from asterism.schemas import (
    ChatModel,
    ChatModelList,
    ChatUpdateRequest,
    NewChatRequest,
)
from asterism.services.dependencies import (
    AuthedUserDep,
    DBSessionDep,
    verify_jwks_token,
)
from asterism.services.websockets import AgentRunnerWebsocket

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

    chat_session = await chat_repository.get_one(
        session_id=chat_id,
        user_id=user.id,
        session=session,
    )
    user_settings = await settings_repository.get_user_settings(
        user_id=user.id,
        session=session,
    )

    if user_settings.default_model is None:
        await websocket.send_json(
            {"type": "ERROR", "message": "No default model"}
        )
        await websocket.close()
        return
    agent: Agent = Agent(
        profile=AgentProfile(
            name="Default Agent",
            description="Description",
            id=uuid.uuid4(),
            max_steps=5,
            model=user_settings.default_model,
            tools=[
                "get_user_name",
                "get_current_timestamp",
                "get_timestamp_at_timezone",
                "web_search",
                "web_fetch",
            ],
        ),
        user=user,
    )

    websocket_connection = AgentRunnerWebsocket(
        chat_session=chat_session,
        websocket=websocket,
        agent=agent,
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
