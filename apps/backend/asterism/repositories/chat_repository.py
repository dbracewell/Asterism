from turtle import title
from typing import List

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from asterism.models.chat_session import ChatSession
from asterism.models.message import Message
from asterism.schemas.chat import ChatSessionInfo, ChatSessionList


class ChatRepository:
    def __init__(self, db_session: AsyncSession):
        self.session = db_session

    async def create_new_session(self, user_id: str) -> ChatSession:
        new_session = ChatSession(user_id=user_id, title="New Chat")
        self.session.add(new_session)
        await self.session.commit()
        return new_session

    async def list_chat_sessions(self, user_id: str) -> ChatSessionList:
        stmt = (
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .order_by(desc(ChatSession.created_at))
        )
        result = await self.session.execute(stmt)
        session_info = []
        for session in result.scalars().all():
            session_info.append(
                ChatSessionInfo(
                    id=session.id, title=session.title or "New Chat Session"
                )
            )
        return ChatSessionList(sessions=session_info)

    async def get_active_branch_thread(
        self,
        leaf_message_id: str,
    ) -> List[Message]:
        """Executes a recursive CTE to pull the correct historical path for a message branch."""
        base_query = (
            select(Message)
            .where(Message.id == leaf_message_id)
            .cte(name="chat_thread", recursive=True)
        )

        parent_msg = aliased(Message)
        recursive_step = select(parent_msg).join(
            base_query, parent_msg.id == base_query.c.parent_message_id
        )

        cte = base_query.union_all(recursive_step)

        stmt = (
            select(Message)
            .join(cte, Message.id == cte.c.id)
            .order_by(Message.created_at.asc())
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().all())
