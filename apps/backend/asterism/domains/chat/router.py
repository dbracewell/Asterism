import asyncio
import uuid

from fastapi import APIRouter, Query, WebSocket

import asterism.domains.agent.service as agent_service
import asterism.domains.chat.service as chat_service
from asterism.common.log import get_logger
from asterism.core.exceptions import CodedException, UnauthorizedException
from asterism.core.schemas import ErrorDetail
from asterism.core.security import verify_jwks_token
from asterism.db.database import db_session_manager
from asterism.domains.agent.agent import Agent
from asterism.domains.chat.capacity import ChatCapacityError
from asterism.domains.chat.connection import WebSocketConnection
from asterism.domains.chat.controller import ChatController
from asterism.domains.chat.jobs import chat_jobs
from asterism.domains.chat.orchestrator import ChatOrchestrator
from asterism.domains.user.lifecycle import assert_active

from .routes import chats, comparisons, drafts, files, messages

chat_router = APIRouter(
    prefix="/chat",
    tags=["files"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@chat_router.websocket("/stream/{chat_id}")
async def chat(
    websocket: WebSocket,
    chat_id: uuid.UUID,
    token: str = Query(...),
) -> None:
    try:
        user = await asyncio.to_thread(verify_jwks_token, token)
    except UnauthorizedException:
        await websocket.close(code=1008, reason="Unauthorized")
        return

    # Reserve before loading history or constructing an agent/controller.
    try:
        admission = chat_jobs.admit_controller(user.id)
    except ChatCapacityError as error:
        await websocket.accept()
        await websocket.send_json(error.packet())
        await websocket.close(code=1013, reason="Chat capacity is full; retry shortly")
        return

    job = None
    try:
        try:
            async with db_session_manager.session() as session:
                # A suspended account's token stays valid until it expires (US-86.2).
                await assert_active(user.id, session)
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

                profile = await agent_service.get_agent_profile(
                    user_id=user.id,
                    agent_id=chat_session.info.agent_id,
                    session=session,
                )

            agent: Agent = Agent(
                model_id=chat_session.info.selected_model_id,
                profile=profile,
                user=user,
                session=chat_session,
                logger=get_logger("ChatSession"),
                allowed_tools=chat_session.info.allowed_tools,
            )
            job = chat_jobs.get_or_create(chat_id, ChatOrchestrator(agent), user_id=user.id)
        except CodedException as error:
            # Rejected before accept, like the unauthorized and no-agent paths
            # (US-77.5). Another user's chat reads as not found.
            if error.code not in (401, 403, 404):
                raise
            reason = {401: "Unauthorized", 404: "Chat not found"}.get(error.code, "Forbidden")
            await websocket.close(code=1008, reason=reason)
            return

        controller = ChatController(
            chat_id=chat_id,
            connection=WebSocketConnection(websocket=websocket),
            job=job,
            admission=admission,
            expires_at=user.expires_at,
        )

        await controller.run()
    finally:
        admission.release()
        if job is not None:
            await chat_jobs.retire_if_idle(chat_id, job)


# Resource routers, after the socket. "chats" goes first: its literal paths
# (/models, /search, /bulk, ...) must match before /{chat_id}.
for _resource in (chats, files, drafts, messages, comparisons):
    chat_router.include_router(_resource.router)
