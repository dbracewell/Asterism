"""Chat-owned file scope composed from project references and the active branch."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files
from asterism.domains.projects.scope import read_project_context

from .branches import active_branch
from .models import ChatFileModel, ChatModel, MessageModel
from .schemas import ChatFileScope, ScopedChatFile


async def resolve_chat_file_scope(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    session: AsyncSession,
) -> ChatFileScope:
    chat = await session.scalar(
        select(ChatModel)
        .where(
            ChatModel.id == chat_id,
            ChatModel.user_id == user_id,
        )
        .execution_options(populate_existing=True)
    )
    if chat is None:
        raise NotFoundException("Chat not found")
    records = list(
        await session.scalars(
            select(MessageModel).where(
                MessageModel.user_id == user_id,
                MessageModel.chat_id == chat_id,
            ),
        ),
    )
    provenance: dict[uuid.UUID, list[uuid.UUID]] = {}
    for message in active_branch(records):
        if message.role == "user":
            for file in message.files:
                provenance.setdefault(file.file_id, []).append(message.id)
    memberships = select(ChatFileModel.file_id).where(
        ChatFileModel.user_id == user_id,
        ChatFileModel.chat_id == chat_id,
    )
    files = await session.scalars(
        select_owned_files(user_id=user_id)
        .with_only_columns(UserFileModel.id)
        .order_by(None)
        .where(
            UserFileModel.id.in_(memberships),
            UserFileModel.id.in_(provenance),
        ),
    )
    local_ids = set(files)
    project_ids: set[uuid.UUID] = set()
    prompt = ""
    revision = None
    if chat.project_id is not None:
        project, ids = await read_project_context(user_id=user_id, project_id=chat.project_id, session=session)
        project_ids = set(ids)
        prompt, revision = project.system_prompt, project.context_revision
    allowed = sorted(local_ids | project_ids, key=str)
    return ChatFileScope(
        chat_id=chat_id,
        project_id=chat.project_id,
        project_context_revision=revision,
        project_system_prompt=prompt,
        allowed_file_ids=allowed,
        files=[
            ScopedChatFile(
                file_id=file_id,
                sources=(["project"] if file_id in project_ids else []) + (["chat"] if file_id in local_ids else []),
                message_ids=provenance.get(file_id, []) if file_id in local_ids else [],
            )
            for file_id in allowed
        ],
        unavailable_file_ids=sorted(set(provenance) - (local_ids | project_ids), key=str),
    )


async def require_chat_file(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
    session: AsyncSession,
) -> None:
    scope = await resolve_chat_file_scope(user_id=user_id, chat_id=chat_id, session=session)
    if file_id not in scope.allowed_file_ids:
        raise NotFoundException("File not found in active chat context")
