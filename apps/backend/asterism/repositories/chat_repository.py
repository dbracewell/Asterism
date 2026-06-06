from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from asterism.models.chat_session import ChatSession
from asterism.models.message import Message


class ChatRepository:
    def __init__(self, db_session: AsyncSession):
        self.session = db_session

    async def create_new_session(self, user_id: str) -> ChatSession:
        new_session = ChatSession(user_id=user_id)
        self.session.add(new_session)
        await self.session.commit()
        return new_session

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
