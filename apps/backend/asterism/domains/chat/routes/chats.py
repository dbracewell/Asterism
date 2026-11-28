"""Chat routes: listing, creating, renaming, moving, deleting and searching chats, and their model and mode."""

import uuid
from typing import Literal

from fastapi import APIRouter, Query

import asterism.domains.agent.service as agent_service
import asterism.domains.chat.service as chat_service
from asterism.common.log import get_logger
from asterism.core.exceptions import CodedException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.agent.agent import Agent
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.user.dependencies import AuthedUserDep

from ..ai_use_log_schemas import AiUseLog, AiUseLogRequest
from ..learning_modes import change_chat_learning_mode
from ..mode_policy import mode_policy_for
from ..mode_policy_schemas import ModePolicy
from ..model_selection import change_chat_model, list_chat_models
from ..schemas import (
    BulkDeleteChatRequest,
    BulkDeleteChatResponse,
    Chat,
    ChatInfo,
    ChatInfoList,
    ChatLearningModeUpdate,
    ChatModelChoice,
    ChatModelUpdate,
    ChatMoveRequest,
    ChatUpdateRequest,
    NewChatRequest,
    SearchResultList,
)

router = APIRouter()


@router.get("/models", response_model=list[ChatModelChoice], operation_id="chatModelsList")
async def available_chat_models(user: AuthedUserDep, session: DBSessionDep) -> list[ChatModelChoice]:
    return await list_chat_models(user.id, session)


@router.put(
    "/{chat_id}/model",
    response_model=ChatInfo,
    operation_id="chatModelUpdate",
    responses={409: {"model": ErrorDetail}},
)
async def select_chat_model(
    chat_id: uuid.UUID,
    payload: ChatModelUpdate,
    user: AuthedUserDep,
    session: DBSessionDep,
) -> ChatInfo:
    return await change_chat_model(user_id=user.id, chat_id=chat_id, payload=payload, session=session)


@router.get("/mode-policy", response_model=ModePolicy, operation_id="chatModePolicyGet")
async def new_chat_mode_policy(
    user: AuthedUserDep,
    session: DBSessionDep,
    project_id: uuid.UUID | None = Query(default=None),
) -> ModePolicy:
    """The effective learning-mode policy a new chat in this project (or General) starts under."""
    return await mode_policy_for(user_id=user.id, project_id=project_id, locked=False, session=session)


@router.put(
    "/{chat_id}/learning-mode",
    operation_id="chatLearningModeUpdate",
    response_model=ChatInfo,
    responses={404: {"model": ErrorDetail}, 409: {"model": ErrorDetail}},
)
async def select_chat_learning_mode(
    chat_id: uuid.UUID,
    payload: ChatLearningModeUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
):
    return await change_chat_learning_mode(user_id=user.id, chat_id=chat_id, payload=payload, session=db)


@router.post(
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


@router.get(
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


@router.post(
    "/ai-use-log",
    operation_id="chatAiUseLogCreate",
    response_model=AiUseLog,
)
async def ai_use_log(payload: AiUseLogRequest, user: AuthedUserDep, db: DBSessionDep) -> AiUseLog:
    """Recorded provenance of the selected chats for an AI-use log; owner only (US-57.4)."""
    from ..ai_use_log import build_log

    return await build_log(user_id=user.id, request=payload, session=db)


@router.delete(
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


@router.delete(
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


@router.patch(
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


@router.get(
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


@router.get(
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
    if (
        chat_session.info.agent_id is not None
        and chat_session.info.context_model is not None
        and not chat_session.info.resume_error
        and all(skill.available for skill in chat_session.info.active_skills.skills)
    ):
        agent = Agent(
            model_id=chat_session.info.selected_model_id,
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
        if chat_session.info.pending_execution is not None:
            agent.apply_execution(chat_session.info.pending_execution)
        try:
            chat_session.context_usage = await ChatOrchestrator(agent).estimate_context_usage()
        except CodedException as error:
            # Live eligibility can change after metadata was read. History and
            # removal controls remain available even when generation is blocked.
            if error.code != 409:
                raise
            chat_session.info.resume_error = str(error)
    return chat_session


@router.patch(
    "/{chat_id}/project",
    response_model=ChatInfo,
    operation_id="chatSessionMove",
    responses={409: {"model": ErrorDetail}},
)
async def move_session(
    chat_id: uuid.UUID,
    payload: ChatMoveRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatInfo:
    from ..membership import move_chat

    return await move_chat(user_id=user.id, chat_id=chat_id, payload=payload, session=db)
