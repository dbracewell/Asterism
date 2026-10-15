"""Idempotent message acceptance; source references and draft consumption commit together."""

import asyncio
import hashlib
import uuid

from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, CodedException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.projects.scope import require_owned_project
from asterism.domains.user.models import UserModel

from .attachments import bind_message_files, resolve_file_references
from .binding import resolve_main_agent_id
from .branches import active_branch
from .draft_models import ChatSendReceiptModel
from .drafts import consume_draft, read_draft_file_ids
from .jobs import chat_jobs
from .model_selection import require_chat_model, selection_info
from .models import ChatModel, MessageModel
from .queries import select_owned_chats, select_owned_messages
from .schemas import Chat, ChatSendRequest, Message, MessageStatus, NewChatRequest


def fingerprint(payload: BaseModel, *, chat_id: uuid.UUID | None = None) -> str:
    return hashlib.sha256((str(chat_id) + payload.model_dump_json(exclude={"request_id"})).encode()).hexdigest()


async def find_receipt(*, user_id: str, request_id: uuid.UUID, expected: str, session: AsyncSession):
    receipt = await session.get(ChatSendReceiptModel, (user_id, request_id))
    if receipt is not None and receipt.fingerprint != expected:
        raise CodedException(409, "Request ID was already used for a different send")
    return receipt


async def accepted_chat(*, receipt: ChatSendReceiptModel, session: AsyncSession) -> Chat:
    chat = await session.scalar(
        select_owned_chats(user_id=receipt.user_id)
        .where(ChatModel.id == receipt.chat_id)
        .execution_options(populate_existing=True),
    )
    message = await session.scalar(
        select_owned_messages(user_id=receipt.user_id, chat_id=receipt.chat_id).where(
            MessageModel.id == receipt.message_id,
        ),
    )
    if chat is None or message is None:
        raise NotFoundException("Accepted message not found")
    from .scope import resolve_chat_file_scope

    scope = await resolve_chat_file_scope(user_id=receipt.user_id, chat_id=receipt.chat_id, session=session)
    response = Message.model_validate(message)
    response.files = [
        file.model_copy(update={"available": file.file_id in scope.allowed_file_ids}) for file in response.files
    ]
    return Chat(info=await selection_info(chat, session), messages=[response])


async def resolve_send_files(
    *,
    user_id: str,
    chat_id: uuid.UUID | None,
    draft_id: uuid.UUID | None,
    file_ids: list[uuid.UUID],
    session: AsyncSession,
):
    if len(file_ids) != len(set(file_ids)):
        raise BadDataException("Attached files must not be repeated")
    staged = await read_draft_file_ids(user_id=user_id, chat_id=chat_id, draft_id=draft_id, session=session)
    ids = list(dict.fromkeys([*file_ids, *staged]))
    if len(ids) > 100:
        raise BadDataException("A message may contain at most 100 files")
    return await resolve_file_references(user_id=user_id, file_ids=ids, session=session)


async def persist_user_send(
    *,
    user_id: str,
    chat: ChatModel,
    payload: NewChatRequest | ChatSendRequest,
    expected: str,
    files,
    parent_id: uuid.UUID | None,
    session: AsyncSession,
) -> Chat:
    await bind_message_files(user_id=user_id, chat_id=chat.id, files=files, session=session)
    message = MessageModel(
        user_id=user_id,
        chat_id=chat.id,
        content=payload.user_prompt,
        role="user",
        status=MessageStatus.PENDING,
        files=files,
        parent_message_id=parent_id,
    )
    session.add(message)
    await session.flush()
    if parent_id is not None:
        await session.execute(
            update(MessageModel)
            .where(
                MessageModel.id == parent_id,
                MessageModel.chat_id == chat.id,
                MessageModel.user_id == user_id,
            )
            .values(active_child_id=message.id, status=MessageStatus.COMPLETED),
        )
    session.add(
        ChatSendReceiptModel(
            user_id=user_id,
            request_id=payload.request_id,
            chat_id=chat.id,
            message_id=message.id,
            fingerprint=expected,
        ),
    )
    await consume_draft(user_id=user_id, draft_id=payload.draft_id, session=session)
    result = Chat(info=await selection_info(chat, session), messages=[Message.model_validate(message)])
    await session.commit()
    return result


async def create_chat(user_id: str, payload: NewChatRequest, session: AsyncSession | None = None) -> Chat:
    if not payload.user_prompt.strip():
        raise BadDataException("User prompt cannot be empty")
    expected = fingerprint(payload)
    async with get_async_db_session(session) as session:
        try:
            await session.execute(update(UserModel).where(UserModel.id == user_id).values(id=UserModel.id))
            receipt = await find_receipt(
                user_id=user_id,
                request_id=payload.request_id,
                expected=expected,
                session=session,
            )
            if receipt is not None:
                result = await accepted_chat(receipt=receipt, session=session)
                await session.commit()
                return result
            agent_id = await resolve_main_agent_id(
                user_id=user_id,
                session=session,
            )
            if payload.project_id is not None:
                await require_owned_project(user_id=user_id, project_id=payload.project_id, session=session)
            files = await resolve_send_files(
                user_id=user_id,
                chat_id=None,
                draft_id=payload.draft_id,
                file_ids=payload.files,
                session=session,
            )
            choice = await require_chat_model(payload.model_id, session)
            if payload.draft_id is not None:
                from .drafts import owned_draft

                draft = await owned_draft(user_id=user_id, draft_id=payload.draft_id, session=session)
                if draft.model_id is not None and draft.model_id != payload.model_id:
                    raise CodedException(409, "Draft model selection changed; reload before sending")
            chat = ChatModel(
                user_id=user_id,
                agent_id=agent_id,
                project_id=payload.project_id,
                selected_model_id=payload.model_id,
                selected_model_snapshot=choice,
            )
            session.add(chat)
            await session.flush()
            return await persist_user_send(
                user_id=user_id,
                chat=chat,
                payload=payload,
                files=files,
                expected=expected,
                parent_id=None,
                session=session,
            )
        except IntegrityError as error:
            await session.rollback()
            receipt = await find_receipt(
                user_id=user_id,
                request_id=payload.request_id,
                expected=expected,
                session=session,
            )
            if receipt is not None:
                result = await accepted_chat(receipt=receipt, session=session)
                await session.commit()
                return result
            raise CodedException(409, "Chat or attachments changed; retry the send") from error
        except (Exception, asyncio.CancelledError):
            await session.rollback()
            raise


async def send_message(*, user_id: str, chat_id: uuid.UUID, payload: ChatSendRequest, session: AsyncSession) -> Message:
    if not payload.user_prompt.strip():
        raise BadDataException("User prompt cannot be empty")
    expected = fingerprint(payload, chat_id=chat_id)
    try:
        # Acknowledgement replay is safe even if generation has since started.
        receipt = await find_receipt(user_id=user_id, request_id=payload.request_id, expected=expected, session=session)
        if receipt is not None:
            return (await accepted_chat(receipt=receipt, session=session)).messages[0]
        # Owner resolution precedes runtime state so foreign activity is not exposed.
        if not await session.scalar(
            select_owned_chats(user_id=user_id).with_only_columns(ChatModel.id).where(ChatModel.id == chat_id),
        ):
            raise NotFoundException("Chat not found")
        with chat_jobs.guard_idle_change(chat_id):
            chat = await session.scalar(
                update(ChatModel)
                .where(
                    ChatModel.id == chat_id,
                    ChatModel.user_id == user_id,
                )
                .values(updated_at=ChatModel.updated_at)
                .returning(ChatModel)
                .execution_options(populate_existing=True),
            )
            if chat is None:
                raise NotFoundException("Chat not found")
            if chat.model_revision != payload.expected_model_revision:
                raise CodedException(409, "Chat model selection changed; reload before sending")
            if chat.selected_model_id is None:
                raise CodedException(409, "Choose a chat model before sending")
            await require_chat_model(chat.selected_model_id, session)
            branch = active_branch(
                list(
                    await session.scalars(
                        select_owned_messages(user_id=user_id, chat_id=chat_id),
                    ),
                ),
            )
            if (branch[-1].id if branch else None) != payload.parent_message_id:
                raise CodedException(409, "Chat branch changed; reload before sending")
            if branch and branch[-1].status == MessageStatus.PENDING:
                raise CodedException(409, "A message is awaiting generation; resume or regenerate it")
            files = await resolve_send_files(
                user_id=user_id,
                chat_id=chat_id,
                draft_id=payload.draft_id,
                file_ids=payload.files,
                session=session,
            )
            result = await persist_user_send(
                user_id=user_id,
                chat=chat,
                payload=payload,
                expected=expected,
                files=files,
                parent_id=payload.parent_message_id,
                session=session,
            )
            return result.messages[0]
    except IntegrityError as error:
        await session.rollback()
        receipt = await find_receipt(user_id=user_id, request_id=payload.request_id, expected=expected, session=session)
        if receipt is not None:
            return (await accepted_chat(receipt=receipt, session=session)).messages[0]
        raise CodedException(409, "Chat or attachments changed; retry the send") from error
    except (Exception, asyncio.CancelledError):
        await session.rollback()
        raise
