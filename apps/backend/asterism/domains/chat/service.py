import uuid

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import (
    BadDataException,
    NotFoundException,
    UnauthorizedException,
)
from asterism.db.database import get_async_db_session

from .models import (
    ChatModel,
    MessageModel,
)
from .schemas import (
    Chat,
    ChatInfo,
    ChatInfoList,
    ChatUpdateRequest,
    Message,
    MessageStatus,
    NewChatRequest,
    NewMessageRequest,
    UpdateMessageRequest,
)


async def add_message(
    user_id: str,
    chat_id: uuid.UUID,
    message: NewMessageRequest,
    session: AsyncSession | None = None,
) -> Message:
    async with get_async_db_session(session) as session:
        new_message = MessageModel(
            **message.model_dump(exclude={"active_child_id"}),
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


async def create_chat(
    user_id: str,
    payload: NewChatRequest,
    session: AsyncSession | None = None,
) -> Chat:
    if not payload.user_prompt:
        raise BadDataException("User prompt cannot be empty")

    async with get_async_db_session(session) as session:
        new_session = ChatModel(
            user_id=user_id,
            folder_id=payload.folder_id,
        )
        session.add(new_session)
        await session.flush()

        new_message = MessageModel(
            chat_id=new_session.id,
            user_id=user_id,
            status=MessageStatus.PENDING,
            content=payload.user_prompt,
            role="user",
            token_count=0,
        )
        session.add(new_message)

        await session.commit()
        await session.refresh(new_session)
        await session.refresh(new_message)

        return Chat(
            info=ChatInfo.model_validate(new_session),
            messages=[Message.model_validate(new_message)],
        )


async def update_chat(
    user_id: str,
    chat_id: uuid.UUID,
    payload: ChatUpdateRequest,
    session: AsyncSession | None = None,
) -> Chat:
    async with get_async_db_session(session) as session:
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
    chat_id: uuid.UUID | None,
    session: AsyncSession | None = None,
) -> Chat:
    async with get_async_db_session(session) as session:
        chat_session = await session.get(ChatModel, chat_id)

        if not chat_session:
            raise NotFoundException(f"Chat with id {chat_id} not found")

        if chat_session.user_id != user_id:
            raise UnauthorizedException(
                f"User {user_id} is not authorized to delete chat session {chat_id}"
            )

        await session.delete(chat_session)
        await session.commit()

        return Chat(
            info=ChatInfo.model_validate(chat_session),
            messages=[],
        )


async def get_many(
    user_id: str,
    session: AsyncSession | None = None,
) -> ChatInfoList:
    async with get_async_db_session(session) as session:
        stmt = (
            select(ChatModel)
            .where(ChatModel.user_id == user_id, ChatModel.folder_id.is_(None))
            .order_by(desc(ChatModel.created_at))
        )
        result = await session.scalars(stmt)
        return ChatInfoList(chats=[ChatInfo.model_validate(r) for r in result.all()])


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

        chat_info = ChatInfo.model_validate(chat_session)

        stmt = select(MessageModel).where(
            MessageModel.chat_id == chat_id,
            MessageModel.user_id == user_id,
        )
        result = await session.execute(stmt)
        all_messages = result.scalars().all()

        if not all_messages:
            return Chat(
                info=chat_info,
                messages=[],
            )

        message_map = {msg.id: msg for msg in all_messages}
        children_map: dict[uuid.UUID | None, list[MessageModel]] = {}
        for msg in all_messages:
            parent_id = msg.parent_message_id
            if parent_id not in children_map:
                children_map[parent_id] = []
            children_map[parent_id].append(msg)

        for parent_id in children_map:
            children_map[parent_id].sort(key=lambda x: x.created_at)

        root_messages = children_map.get(None, [])
        if not root_messages:
            return Chat(
                info=chat_info,
                messages=[],
            )

        current_node = root_messages[0]
        active_thread: list[Message] = []

        while current_node is not None:
            parent_id = current_node.parent_message_id
            thread_msg = Message.model_validate(current_node)
            siblings = children_map.get(parent_id, [])
            node_index = siblings.index(current_node)
            thread_msg.has_siblings = len(siblings) > 1
            thread_msg.sibling_count = len(siblings)
            thread_msg.current_sibling_index = node_index + 1
            thread_msg.next_sibling_id = (
                siblings[node_index + 1].id if node_index + 1 < len(siblings) else None
            )
            thread_msg.previous_sibling_id = (
                siblings[node_index - 1].id if node_index - 1 >= 0 else None
            )
            active_thread.append(thread_msg)

            if (
                current_node.active_child_id
                and current_node.active_child_id in message_map
            ):
                current_node = message_map[current_node.active_child_id]
            else:
                break

        return Chat(
            info=chat_info,
            messages=active_thread,
        )
