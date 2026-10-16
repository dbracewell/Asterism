"""Chat-owned file scope composed from project references and the active branch."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import NotFoundException
from asterism.domains.agent.execution_scope import ChatScopeSnapshot, FileProvenance, ProjectScopeSnapshot
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files
from asterism.domains.projects.queries import selected_agent_ids
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
    chat = await read_chat_scope_snapshot(user_id=user_id, chat_id=chat_id, session=session)
    project = (
        await read_project_scope_snapshot(user_id=user_id, project_id=chat.project_id, session=session)
        if chat.project_id is not None
        else None
    )
    provenance: dict[uuid.UUID, tuple[set[str], list[uuid.UUID]]] = {}
    for file in (*chat.files, *(project.files if project else ())):
        sources, message_ids = provenance.setdefault(file.file_id, (set(), []))
        sources.update(file.sources)
        message_ids.extend(file.message_ids)
    allowed = sorted(provenance, key=str)
    return ChatFileScope(
        chat_id=chat_id,
        project_id=chat.project_id,
        project_context_revision=project.prompt_revision if project else None,
        project_system_prompt=project.system_prompt if project else "",
        allowed_file_ids=allowed,
        files=[
            ScopedChatFile(
                file_id=file_id,
                sources=[source for source in ("project", "chat") if source in sources],
                message_ids=sorted(set(message_ids), key=str),
            )
            for file_id, (sources, message_ids) in sorted(provenance.items(), key=lambda item: str(item[0]))
        ],
        unavailable_file_ids=sorted(chat.referenced_file_ids - set(allowed), key=str),
    )


async def read_chat_scope_snapshot(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    session: AsyncSession,
) -> ChatScopeSnapshot:
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
    branch = active_branch(records)
    provenance: dict[uuid.UUID, list[uuid.UUID]] = {}
    for message in branch:
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
    return ChatScopeSnapshot(
        chat_id=chat_id,
        project_id=chat.project_id,
        active_branch_message_ids=tuple(message.id for message in branch),
        files=tuple(
            FileProvenance(file_id=file_id, sources=("chat",), message_ids=tuple(provenance[file_id]))
            for file_id in sorted(local_ids.intersection(provenance), key=str)
        ),
        referenced_file_ids=frozenset(provenance),
    )


async def read_project_scope_snapshot(
    *,
    user_id: str,
    project_id: uuid.UUID,
    session: AsyncSession,
) -> ProjectScopeSnapshot:
    project, file_ids = await read_project_context(user_id=user_id, project_id=project_id, session=session)
    eligible_ids = frozenset(await session.scalars(selected_agent_ids(user_id=user_id, project_id=project_id)))
    return ProjectScopeSnapshot(
        project_id=project_id,
        prompt_revision=project.context_revision,
        eligible_sub_agent_ids=eligible_ids,
        files=tuple(FileProvenance(file_id=file_id, sources=("project",)) for file_id in sorted(file_ids, key=str)),
        system_prompt=project.system_prompt,
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
