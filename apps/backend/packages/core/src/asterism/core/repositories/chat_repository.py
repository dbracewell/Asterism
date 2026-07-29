import uuid

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.db import get_async_db_session
from asterism.core.exceptions import NotFoundException, UnauthorizedException
from asterism.core.models import (
    Chat,
    ChatInfo,
    ChatModel,
    ChatModelList,
    Message,
    MessageModel,
)
from asterism.core.models.common import LLMModel
from asterism.core.models.message import MessageStatus
from asterism.core.services.schemas import ChatUpdateRequest
from asterism.core.services.schemas.message import (
    NewMessage,
    UpdateMessage,
)


class ChatRepository:
    async def add_message(
        self,
        user_id: str,
        session_id: uuid.UUID,
        message: NewMessage,
        child_message: NewMessage | None = None,
        session: AsyncSession | None = None,
    ) -> Message:
        async with get_async_db_session(session) as session:
            new_message = Message(
                **message.model_dump(exclude={"active_child_id"}),
                user_id=user_id,
                session_id=session_id,
            )
            active_child = None
            if child_message:
                active_child = Message(
                    **child_message.model_dump(exclude={"active_child_id"}),
                    user_id=user_id,
                    session_id=session_id,
                )
                new_message.active_child = active_child
                active_child.parent_message_id = new_message.id

            session.add(new_message)
            if active_child:
                session.add(active_child)

            if new_message.parent_message_id:
                await session.flush()
                await session.execute(
                    update(Message)
                    .where(Message.id == new_message.parent_message_id)
                    .values(active_child_id=new_message.id)
                )

            await session.commit()
            new_message.active_child = active_child
            return new_message

    async def update_message(
        self,
        user_id: str,
        session_id: uuid.UUID,
        message_id: uuid.UUID,
        payload: UpdateMessage,
        session: AsyncSession | None = None,
    ) -> MessageModel:
        async with get_async_db_session(session) as session:
            message = await session.get(Message, message_id)
            if not message:
                raise NotFoundException()
            if message.user_id != user_id:
                raise UnauthorizedException()
            if message.session_id != session_id:
                raise UnauthorizedException()

            if payload.active_child_id is not None:
                message.active_child_id = payload.active_child_id
            if payload.content is not None:
                message.content = payload.content
            if payload.thinking is not None:
                message.thinking = payload.thinking
            if payload.status is not None:
                message.status = payload.status

            await session.merge(message)
            await session.commit()
            await session.refresh(message)
            return MessageModel.model_validate(message)

    async def set_active_child(
        self,
        user_id: str,
        session_id: uuid.UUID,
        parent_id: uuid.UUID,
        child_id: uuid.UUID,
        session: AsyncSession | None = None,
    ) -> MessageModel:
        async with get_async_db_session(session) as session:
            stmt = select(Message).where(
                Message.user_id == user_id,
                Message.session_id == session_id,
                Message.id == parent_id,
            )
            r = await session.scalars(stmt)
            msg = r.first()
            if not msg:
                raise NotFoundException()
            await session.execute(
                update(Message)
                .where(
                    Message.user_id == user_id,
                    Message.session_id == session_id,
                )
                .values(active_child_id=None)
            )
            msg.active_child_id = child_id
            await session.merge(msg)
            await session.refresh(msg)
            await session.commit()
            return MessageModel.model_validate(msg)

    async def create(
        self,
        user_id: str,
        user_prompt: str,
        model: LLMModel,
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
                model=model,
            )
            session.add(new_message)

            await session.commit()

            await session.refresh(new_session)
            await session.refresh(new_message)

            return ChatModel(
                info=ChatInfo.model_validate(new_session),
                messages=[MessageModel.model_validate(new_message)],
            )

    async def update(
        self,
        user_id: str,
        session_id: uuid.UUID,
        update: ChatUpdateRequest,
        session: AsyncSession | None = None,
    ) -> ChatModel:
        async with get_async_db_session(session) as session:
            chat_session = await session.get(Chat, session_id)
            if not chat_session:
                raise NotFoundException()
            if chat_session.user_id != user_id:
                raise UnauthorizedException()
            if update.folder_id is not None:
                chat_session.folder_id = update.folder_id
            if update.title is not None:
                chat_session.title = update.title
            await session.merge(chat_session)
            await session.refresh(chat_session)
            await session.commit()
            return ChatModel(
                info=ChatInfo.model_validate(chat_session),
                messages=[],
            )

    async def delete(
        self,
        user_id: str,
        session_id: uuid.UUID | None,
        session: AsyncSession | None = None,
    ) -> ChatModel:
        async with get_async_db_session(session) as session:
            chat_session = await session.get(Chat, session_id)
            if not chat_session:
                raise NotFoundException()
            if chat_session.user_id != user_id:
                raise UnauthorizedException()
            await session.delete(chat_session)
            await session.commit()
            return ChatModel(
                info=ChatInfo.model_validate(chat_session),
                messages=[],
            )

    async def get_many(
        self,
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
            return ChatModelList(
                chats=[ChatInfo.model_validate(r) for r in result.all()]
            )

    async def get_one(
        self,
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
                siblings = children_map.get(parent_id, [])  # type:ignore
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


chat_repository = ChatRepository()
