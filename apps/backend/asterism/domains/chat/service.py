import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import (
    BadDataException,
    NotFoundException,
    UnauthorizedException,
)
from asterism.db.database import get_async_db_session
from asterism.db.queries import paginate_select
from asterism.domains.files.models import FileContentStatus

from .attachments import bind_message_files, resolve_file_references
from .branches import active_branch
from .models import (
    ChatModel,
    MessageModel,
)
from .queries import select_owned_chats, select_owned_messages
from .schemas import (
    BulkDeleteChatResponse,
    Chat,
    ChatContextModel,
    ChatInfo,
    ChatInfoList,
    ChatUpdateRequest,
    Message,
    MessageStatus,
    NewMessageRequest,
    UpdateMessageRequest,
)
from .search import search as search
from .sending import create_chat as create_chat


async def add_message(
    user_id: str,
    chat_id: uuid.UUID,
    message: NewMessageRequest,
    session: AsyncSession | None = None,
) -> Message:
    async with get_async_db_session(session) as session:
        await _lock_owned_chat(user_id=user_id, chat_id=chat_id, session=session)
        if message.parent_message_id is not None:
            await _owned_message(
                user_id=user_id,
                chat_id=chat_id,
                message_id=message.parent_message_id,
                session=session,
            )
        if message.files and message.role != "user":
            raise BadDataException("Only user messages can attach files")
        files = await resolve_file_references(user_id=user_id, file_ids=message.files, session=session)
        await bind_message_files(user_id=user_id, chat_id=chat_id, files=files, session=session)
        new_message = MessageModel(
            **message.model_dump(exclude={"active_child_id", "files"}),
            files=files,
            user_id=user_id,
            chat_id=chat_id,
        )
        session.add(new_message)

        if new_message.parent_message_id:
            await session.flush()
            stmt = (
                update(MessageModel)
                .where(
                    MessageModel.id == new_message.parent_message_id,
                    MessageModel.user_id == user_id,
                    MessageModel.chat_id == chat_id,
                )
                .values(
                    active_child_id=new_message.id,
                    status=MessageStatus.COMPLETED,
                )
            )
            await session.execute(stmt)

        await session.commit()
        return Message.model_validate(new_message)


async def update_message(
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: UpdateMessageRequest,
    session: AsyncSession | None = None,
) -> Message:
    async with get_async_db_session(session) as session:
        await _lock_owned_chat(user_id=user_id, chat_id=chat_id, session=session)
        await _owned_message(user_id=user_id, chat_id=chat_id, message_id=message_id, session=session)
        if payload.active_child_id is not None:
            child = await _owned_message(
                user_id=user_id, chat_id=chat_id, message_id=payload.active_child_id, session=session,
            )
            if child.parent_message_id != message_id:
                raise BadDataException("Active child must be a direct child of this message")
        update_stmt = (
            update(MessageModel)
            .where(
                MessageModel.id == message_id,
                MessageModel.user_id == user_id,
                MessageModel.chat_id == chat_id,
            )
            .values(**payload.model_dump(exclude_unset=True))
            .returning(MessageModel)
        )
        message = await session.scalar(update_stmt)
        await session.commit()
        return Message.model_validate(message)


async def update_chat(
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatUpdateRequest,
    session: AsyncSession | None = None,
) -> Chat:
    async with get_async_db_session(session) as session:
        await _lock_owned_chat(user_id=user_id, chat_id=chat_id, session=session)
        update_stmt = (
            update(ChatModel)
            .where(
                ChatModel.user_id == user_id,
                ChatModel.id == chat_id,
            )
            .values(**payload.model_dump(exclude_unset=True))
            .returning(ChatModel)
        )
        chat_session = await session.scalar(update_stmt)
        await session.commit()

        return Chat(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def delete_chat(
    user_id: str,
    chat_id: uuid.UUID,
    session: AsyncSession | None = None,
) -> Chat:
    async with get_async_db_session(session) as session:
        chat_session = await session.get(ChatModel, chat_id)

        if not chat_session:
            raise NotFoundException(f"Chat with id {chat_id} not found")

        if chat_session.user_id != user_id:
            raise UnauthorizedException(f"User {user_id} is not authorized to delete chat session {chat_id}")

        # Stop the process-local runtime before persistence deletion. This
        # prevents a cancelled provider task from writing a late message.
        from asterism.domains.chat.jobs import chat_jobs

        await chat_jobs.retire(chat_id)
        await session.delete(chat_session)
        await session.commit()

        return Chat(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def delete_chats(
    user_id: str,
    chat_ids: list[uuid.UUID],
    session: AsyncSession | None = None,
) -> BulkDeleteChatResponse:
    unique_ids = list(dict.fromkeys(chat_ids))
    async with get_async_db_session(session) as session:
        owned_ids = list(
            await session.scalars(
                select(ChatModel.id).where(
                    ChatModel.user_id == user_id,
                    ChatModel.id.in_(unique_ids),
                ),
            ),
        )
        if len(owned_ids) != len(unique_ids):
            raise NotFoundException("One or more chats were not found")

        from asterism.domains.chat.jobs import chat_jobs

        for chat_id in owned_ids:
            await chat_jobs.retire(chat_id)
        await session.execute(
            delete(ChatModel).where(
                ChatModel.user_id == user_id,
                ChatModel.id.in_(unique_ids),
            ),
        )
        await session.commit()
        return BulkDeleteChatResponse(deleted_chat_ids=owned_ids)


async def get_many(
    user_id: str,
    session: AsyncSession | None = None,
    *,
    project_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 50,
) -> ChatInfoList:
    async with get_async_db_session(session) as session:
        if project_id is not None:
            from asterism.domains.projects.scope import require_owned_project

            await require_owned_project(user_id=user_id, project_id=project_id, session=session)
        statement = select_owned_chats(user_id=user_id).where(ChatModel.project_id == project_id)
        result = await paginate_select(statement=statement, session=session, page=page, page_size=page_size)
        return ChatInfoList(
            chats=[ChatInfo.model_validate(chat) for chat in result.records],
            total=result.total,
            page=page,
            page_size=page_size,
        )


async def _get_context_model(chat_session: ChatModel, session: AsyncSession) -> ChatContextModel | None:
    from .model_selection import selected_chat_model

    model = await selected_chat_model(chat_session, session)
    if model is None or not model.available:
        return None
    return ChatContextModel(
        id=model.id,
        name=model.name,
        context_window=model.context_window,
        context_window_source=model.context_window_source,
    )


async def get_one(
    chat_id: uuid.UUID,
    user_id: str,
    session: AsyncSession | None = None,
) -> Chat:

    async with get_async_db_session(session) as session:
        chat_session = await session.get(ChatModel, chat_id)
        if not chat_session:
            raise NotFoundException()
        if chat_session.user_id != user_id:
            raise UnauthorizedException()

        from .model_selection import selection_info

        chat_info = await selection_info(chat_session, session)
        chat_info.context_model = await _get_context_model(chat_session, session)

        stmt = select_owned_messages(user_id=user_id, chat_id=chat_id)
        result = await session.execute(stmt)
        all_messages = result.scalars().all()

        if not all_messages:
            return Chat(
                info=chat_info,
                messages=[],
            )

        messages = active_branch(all_messages)
        from .scope import resolve_chat_file_scope

        records_by_id = {message.id: message for message in all_messages}
        pending = next(
            (
                records_by_id[message.id]
                for message in reversed(messages)
                if message.role in {"user", "assistant"} and message.status == MessageStatus.PENDING
            ),
            None,
        )
        if pending is not None and pending.pending_execution is not None:
            from asterism.core.exceptions import CodedException
            from asterism.domains.agent.schemas import MainAgentConfiguration
            from asterism.domains.agent.service import get_main_agent_profile

            from .execution import validate_recorded_execution

            execution = pending.pending_execution
            chat_info.pending_execution = execution
            try:
                current = MainAgentConfiguration.model_validate(await get_main_agent_profile(user_id, session))
                choice = await validate_recorded_execution(execution, current, session)
                chat_info.context_model = ChatContextModel(
                    id=choice.id,
                    name=choice.name,
                    context_window=choice.context_window,
                    context_window_source=choice.context_window_source,
                )
            except CodedException as error:
                chat_info.resume_error = str(error)
                chat_info.context_model = None
        scope = await resolve_chat_file_scope(user_id=user_id, chat_id=chat_id, session=session)
        allowed = set(scope.allowed_file_ids)
        for message in messages:
            message.files = [
                file
                if file.file_id in allowed
                else file.model_copy(
                    update={"status": FileContentStatus.FAILED, "available": False},
                )
                for file in message.files
            ]
        return Chat(info=chat_info, messages=messages)


async def _lock_owned_chat(*, user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> ChatModel:
    chat = await session.scalar(
        update(ChatModel)
        .where(
            ChatModel.user_id == user_id,
            ChatModel.id == chat_id,
        )
        .values(updated_at=ChatModel.updated_at)
        .returning(ChatModel),
    )
    if chat is None:
        raise NotFoundException("Chat not found")
    return chat


async def _owned_message(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    session: AsyncSession,
) -> MessageModel:
    message = await session.scalar(
        select_owned_messages(user_id=user_id, chat_id=chat_id).where(
            MessageModel.id == message_id,
        ),
    )
    if message is None:
        raise NotFoundException("Message not found")
    return message
