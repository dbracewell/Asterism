"""Live authorization reader shared by retrieval and model-facing file reads."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from asterism.core.exceptions import BadDataException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ExecutionScope, FileProvenance
from asterism.domains.agent.service import get_agent_profile
from asterism.domains.tools.context import ContextToolScope

from .delegation import require_delegation_target
from .model_selection import require_chat_model
from .models import MessageModel
from .schemas import MessageStatus
from .scope import read_chat_scope_snapshot, read_project_scope_snapshot


@dataclass(frozen=True)
class AuthorizedFiles:
    files: tuple[FileProvenance, ...]
    context_revision: int | None


async def read_execution_files(
    scope: ExecutionScope,
    *,
    ceiling: ContextToolScope | None,
    check_active: Callable[[], Awaitable[None]] | None = None,
) -> AuthorizedFiles:
    if check_active:
        await check_active()
    if scope.executed_model is None:
        raise BadDataException("File execution model is unavailable")
    if ceiling is not None and (
        ceiling.user_id != scope.user_id
        or ceiling.chat_id != scope.chat_id
        or ceiling.project_id != scope.project_id
        or ceiling.caller_agent_id != scope.agent_id
        or ceiling.model_id != scope.executed_model.id
    ):
        raise BadDataException("Invalid file execution context")
    async with get_async_db_session() as db:
        model = await require_chat_model(scope.executed_model.id, scope.user_id, db)
        if (scope.executed_model.name is not None and model.name != scope.executed_model.name) or (
            scope.executed_model.provider_id is not None and model.provider_id != scope.executed_model.provider_id
        ):
            raise BadDataException("File execution model identity changed")
        profile = await get_agent_profile(scope.user_id, scope.agent_id, db)
        if profile.sub_agent != scope.is_sub_agent:
            raise BadDataException("File execution agent identity changed")
        if profile.sub_agent:
            await require_delegation_target(
                user_id=scope.user_id,
                chat_id=scope.chat_id,
                scope=ceiling.delegation if ceiling else None,
                target_id=scope.agent_id,
                config_revision=scope.configuration_revision,
                session=db,
            )
            if profile.model_id != scope.executed_model.id:
                raise BadDataException("Sub-agent model binding changed")
        if scope.request_message_id is not None:
            request = await db.get(MessageModel, scope.request_message_id)
            if (
                request is None
                or request.user_id != scope.user_id
                or request.chat_id != scope.chat_id
                or request.status == MessageStatus.CANCELLED
                or request.pending_execution is None
                or request.pending_execution.id != scope.execution_id
            ):
                raise BadDataException("File execution was canceled or replaced")
        chat = await read_chat_scope_snapshot(user_id=scope.user_id, chat_id=scope.chat_id, session=db)
        if scope.request_message_id is not None and scope.request_message_id not in chat.active_branch_message_ids:
            raise BadDataException("File execution branch changed")
        if chat.project_id != scope.project_id:
            raise BadDataException("File execution project changed")
        project = (
            await read_project_scope_snapshot(user_id=scope.user_id, project_id=chat.project_id, session=db)
            if chat.project_id
            else None
        )
        ids = scope.allowed_file_ids & (ceiling.file_ids if ceiling else scope.allowed_file_ids)
        # Merge provenance only for live project and active-branch memberships.
        merged: dict[uuid.UUID, tuple[set[str], set[uuid.UUID]]] = {}
        for file in (*chat.files, *(project.files if project else ())):
            if file.file_id in ids:
                sources, messages = merged.setdefault(file.file_id, (set(), set()))
                sources.update(file.sources)
                messages.update(file.message_ids)
        files = tuple(
            FileProvenance(
                file_id=file_id,
                sources=tuple(source for source in ("project", "chat") if source in sources),
                message_ids=tuple(sorted(messages, key=str)),
            )
            for file_id, (sources, messages) in sorted(merged.items(), key=lambda item: str(item[0]))
        )
    if check_active:
        await check_active()
    return AuthorizedFiles(files, project.prompt_revision if project else None)


def create_runtime_file_reader(
    *,
    ceiling: ContextToolScope | None,
    check_active: Callable[[], Awaitable[None]] | None = None,
):
    from asterism.core import config
    from asterism.domains.files.runtime_access import RuntimeFileReader
    from asterism.domains.files.service import ensure_file_processed
    from asterism.domains.files.store import get_file_store

    async def authorize(scope: ExecutionScope) -> frozenset[uuid.UUID]:
        snapshot = await read_execution_files(scope, ceiling=ceiling, check_active=check_active)
        return frozenset(file.file_id for file in snapshot.files)

    async def process(file, db):
        return await ensure_file_processed(file=file, session=db)

    return RuntimeFileReader(
        authorize=authorize,
        store=get_file_store(),
        max_image_bytes=config.max_vision_image_bytes,
        process_file=process,
    )
