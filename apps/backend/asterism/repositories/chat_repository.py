import uuid

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common import NotFoundException, UnauthorizedException
from asterism.db import get_async_db_session
from asterism.models import (
    Chat,
    Message,
)
from asterism.models.message import MessageStatus
from asterism.schemas import (
    ChatInfo,
    ChatModel,
    ChatModelList,
    ChatUpdateRequest,
    MessageModel,
    NewMessage,
    UpdateMessage,
)


async def add_message(
    user_id: str,
    session_id: uuid.UUID,
    message: NewMessage,
    session: AsyncSession | None = None,
) -> MessageModel:
    async with get_async_db_session(session) as session:
        new_message = Message(
            **message.model_dump(exclude={"active_child_id"}),
            user_id=user_id,
            session_id=session_id,
        )
        session.add(new_message)

        if new_message.parent_message_id:
            await session.flush()
            stmt = (
                update(Message)
                .where(
                    Message.id == new_message.parent_message_id,
                    Message.user_id == user_id,
                    Message.session_id == session_id,
                )
                .values(active_child_id=new_message.id)
            )
            await session.execute(stmt)

        await session.commit()
        return MessageModel.model_validate(new_message)


async def update_message(
    user_id: str,
    session_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: UpdateMessage,
    session: AsyncSession | None = None,
) -> MessageModel:
    async with get_async_db_session(session) as session:
        update_stmt = (
            update(Message)
            .where(
                Message.id == message_id,
                Message.user_id == user_id,
                Message.session_id == session_id,
            )
            .values(**payload.model_dump(exclude_unset=True))
            .returning(Message)
        )
        message = await session.execute(update_stmt)
        await session.commit()
        return MessageModel.model_validate(message)


async def create_session(
    user_id: str,
    user_prompt: str,
    folder_id: uuid.UUID | None,
    session: AsyncSession | None = None,
) -> ChatModel:
    async with get_async_db_session(session) as session:
        new_session = Chat(
            user_id=user_id,
            folder_id=folder_id,
        )
        session.add(new_session)
        await session.flush()

        new_message = Message(
            session_id=new_session.id,
            user_id=user_id,
            status=MessageStatus.PENDING,
            content=user_prompt,
            role="user",
            token_count=0,
        )
        session.add(new_message)

        await session.commit()
        await session.refresh(new_session)
        await session.refresh(new_message)

        return ChatModel(
            info=ChatInfo.model_validate(new_session),
            messages=[MessageModel.model_validate(new_message)],
        )


async def update_session(
    user_id: str,
    session_id: uuid.UUID,
    payload: ChatUpdateRequest,
    session: AsyncSession | None = None,
) -> ChatModel:
    async with get_async_db_session(session) as session:
        update_stmt = (
            update(Chat)
            .where(
                Chat.user_id == user_id,
                Chat.session_id == session_id,
            )
            .values(**payload.model_dump(exclude_unset=True))
            .returning(Message)
        )
        chat_session = await session.execute(update_stmt)
        await session.commit()
        return ChatModel(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def delete_session(
    user_id: str,
    session_id: uuid.UUID | None,
    session: AsyncSession | None = None,
) -> ChatModel:
    async with get_async_db_session(session) as session:
        chat_session = await session.get(Chat, session_id)
        if not chat_session:
            raise NotFoundException(f"Chat session with id {session_id} not found")
        if chat_session.user_id != user_id:
            raise UnauthorizedException(
                f"User {user_id} is not authorized to delete chat session {session_id}"
            )
        await session.delete(chat_session)
        await session.commit()
        return ChatModel(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def get_many(
    user_id: str,
    session: AsyncSession | None = None,
) -> ChatModelList:
    async with get_async_db_session(session) as session:
        stmt = (
            select(Chat)
            .where(Chat.user_id == user_id, Chat.folder_id.is_(None))
            .order_by(desc(Chat.created_at))
        )
        result = await session.scalars(stmt)
        return ChatModelList(chats=[ChatInfo.model_validate(r) for r in result.all()])


async def get_one(
    session_id: uuid.UUID,
    user_id: str,
    session: AsyncSession | None = None,
) -> ChatModel:

    async with get_async_db_session(session) as session:
        chat_session = await session.get(Chat, session_id)
        if not chat_session:
            raise NotFoundException()
        if chat_session.user_id != user_id:
            raise UnauthorizedException()

        chat_session_model = ChatInfo.model_validate(chat_session)

        stmt = select(Message).where(
            Message.session_id == session_id,
            Message.user_id == user_id,
        )
        result = await session.execute(stmt)
        all_messages = result.scalars().all()

        if not all_messages:
            return ChatModel(
                info=chat_session_model,
                messages=[],
            )

        message_map = {msg.id: msg for msg in all_messages}
        children_map: dict[uuid.UUID | None, list[Message]] = {}
        for msg in all_messages:
            parent_id = msg.parent_message_id
            if parent_id not in children_map:
                children_map[parent_id] = []
            children_map[parent_id].append(msg)

        for parent_id in children_map:
            children_map[parent_id].sort(key=lambda x: x.created_at)

        root_messages = children_map.get(None, [])
        if not root_messages:
            return ChatModel(
                info=chat_session_model,
                messages=[],
            )

        current_node = root_messages[0]
        active_thread: list[MessageModel] = []

        while current_node is not None:
            parent_id = current_node.parent_message_id
            thread_msg = MessageModel.model_validate(current_node)
            siblings = children_map.get(parent_id, [])
            thread_msg.has_siblings = len(siblings) > 1
            thread_msg.sibling_count = len(siblings)
            thread_msg.current_sibling_index = siblings.index(current_node) + 1
            active_thread.append(thread_msg)

            if (
                current_node.active_child_id
                and current_node.active_child_id in message_map
            ):
                current_node = message_map[current_node.active_child_id]
            else:
                break

        return ChatModel(
            info=chat_session_model,
            messages=active_thread,
        )
