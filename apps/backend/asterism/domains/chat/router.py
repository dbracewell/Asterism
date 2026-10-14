import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, UploadFile, WebSocket
from fastapi.responses import FileResponse

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
from asterism.domains.files.schemas import UserFile, UserFileList
from asterism.domains.user.dependencies import AuthedUserDep

from .schemas import (
    BulkDeleteChatRequest,
    BulkDeleteChatResponse,
    Chat,
    ChatDraft,
    ChatDraftCreate,
    ChatDraftFiles,
    ChatFileScope,
    ChatInfo,
    ChatInfoList,
    ChatMoveRequest,
    ChatSendRequest,
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
            reason="This chat has no assigned main agent",
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
    responses={409: {"model": ErrorDetail}},
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
    project_id: uuid.UUID | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> ChatInfoList:
    return await chat_service.get_many(
        user_id=user.id,
        project_id=project_id,
        page=page,
        page_size=page_size,
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
async def search_chats_and_projects(
    q: str,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    scope: Literal["all", "general", "project"] = "all",
    project_id: uuid.UUID | None = None,
) -> SearchResultList:
    return await chat_service.search(
        user_id=user.id,
        query=q,
        scope=scope,
        project_id=project_id,
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


@chat_router.get("/{chat_id}/files/context", response_model=ChatFileScope, operation_id="chatFileGetScope")
async def get_file_scope(chat_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ChatFileScope:
    from .scope import resolve_chat_file_scope

    return await resolve_chat_file_scope(user_id=user.id, chat_id=chat_id, session=db)


@chat_router.get("/{chat_id}/files/{file_id}/info", response_model=UserFile, operation_id="chatFileGetInfo")
async def get_chat_file_info(chat_id: uuid.UUID, file_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> UserFile:
    from asterism.domains.files.service import get_file_info_by_id

    from .scope import require_chat_file

    await require_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
    return await get_file_info_by_id(user_id=user.id, file_id=file_id, session=db)


@chat_router.get(
    "/{chat_id}/files/{file_id}",
    response_class=FileResponse,
    operation_id="chatFileDownload",
    responses={
        200: {
            "description": "Authorized original source download",
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
            },
        },
    },
)
async def download_chat_file(chat_id: uuid.UUID, file_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep):
    from asterism.domains.files.service import download_file_by_id

    from .scope import require_chat_file

    await require_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
    return await download_file_by_id(user_id=user.id, file_id=file_id, session=db)


@chat_router.patch(
    "/{chat_id}/project", response_model=ChatInfo, operation_id="chatSessionMove",
    responses={409: {"model": ErrorDetail}},
)
async def move_session(
    chat_id: uuid.UUID, payload: ChatMoveRequest, user: AuthedUserDep, db: DBSessionDep,
) -> ChatInfo:
    from .membership import move_chat

    return await move_chat(user_id=user.id, chat_id=chat_id, payload=payload, session=db)


@chat_router.post("/drafts", response_model=ChatDraft, operation_id="chatDraftCreate")
async def create_draft(payload: ChatDraftCreate, user: AuthedUserDep, db: DBSessionDep) -> ChatDraft:
    from .drafts import create_draft

    return await create_draft(user_id=user.id, payload=payload, session=db)


@chat_router.get("/drafts/{draft_id}", response_model=ChatDraft, operation_id="chatDraftGetOne")
async def read_draft(draft_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ChatDraft:
    from .drafts import get_draft

    return await get_draft(user_id=user.id, draft_id=draft_id, session=db)


@chat_router.delete("/drafts/{draft_id}", response_model=ChatDraft, operation_id="chatDraftDiscard")
async def discard_draft(draft_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> ChatDraft:
    from .drafts import discard_draft

    return await discard_draft(user_id=user.id, draft_id=draft_id, session=db)


@chat_router.post("/drafts/{draft_id}/files", response_model=ChatDraft, operation_id="chatDraftAddFiles")
async def add_draft_files(
    draft_id: uuid.UUID, payload: ChatDraftFiles, user: AuthedUserDep, db: DBSessionDep,
) -> ChatDraft:
    from .drafts import change_draft_files

    return await change_draft_files(user_id=user.id, draft_id=draft_id, payload=payload, remove=False, session=db)


@chat_router.delete("/drafts/{draft_id}/files", response_model=ChatDraft, operation_id="chatDraftRemoveFiles")
async def remove_draft_files(
    draft_id: uuid.UUID, payload: ChatDraftFiles, user: AuthedUserDep, db: DBSessionDep,
) -> ChatDraft:
    from .drafts import change_draft_files

    return await change_draft_files(user_id=user.id, draft_id=draft_id, payload=payload, remove=True, session=db)


@chat_router.post("/drafts/{draft_id}/uploads", response_model=UserFileList, operation_id="chatDraftUpload")
async def upload_draft_files(
    draft_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep,
    files: Annotated[list[UploadFile], File(description="Stage uploaded library sources for this draft")],
) -> UserFileList:
    from asterism.domains.files.service import upload_files

    from .drafts import change_draft_files, get_draft

    # Source ingestion commits independently; only an accepted message grants runtime access.
    # Revalidation after ingest covers cancellation/expiry while the upload was running.
    await get_draft(user_id=user.id, draft_id=draft_id, session=db)
    result = await upload_files(user_id=user.id, uploads=files, session=db)
    await change_draft_files(user_id=user.id, draft_id=draft_id,
                             payload=ChatDraftFiles(file_ids=[file.id for file in result.files]),
                             remove=False, session=db)
    return result


@chat_router.post("/{chat_id}/message", response_model=Message, operation_id="chatMessageSend",
                  responses={409: {"model": ErrorDetail}})
async def send_message(chat_id: uuid.UUID, payload: ChatSendRequest, user: AuthedUserDep, db: DBSessionDep) -> Message:
    from .sending import send_message

    return await send_message(user_id=user.id, chat_id=chat_id, payload=payload, session=db)


@chat_router.delete("/{chat_id}/files/{file_id}", response_model=ChatFileScope, operation_id="chatFileRemove",
                    responses={409: {"model": ErrorDetail}})
async def remove_chat_file(
    chat_id: uuid.UUID, file_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep,
) -> ChatFileScope:
    from .attachments import remove_chat_file

    return await remove_chat_file(user_id=user.id, chat_id=chat_id, file_id=file_id, session=db)
