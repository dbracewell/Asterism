import asyncio
import json
import time
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.llm.client import LLMClient
from asterism.core.llm.typedefs import LLMEventType, Message
from asterism.core.models.chat_session import ChatSessionModel
from asterism.core.models.message import MessageModel, NewMessage
from asterism.core.repositories import chat_repository

client = LLMClient(
    api_key="abc",
    llm_host="http://localhost:1234/v1",
    model_name="gemma-4-26b-a4b-it",
)


async def generate(
    chat_session: ChatSessionModel,
    prompt: str,
    queue: asyncio.Queue,
    session: AsyncSession,
):
    start_time = time.perf_counter()
    messages: list[Message] = []
    for m in chat_session.messages:
        messages.append(Message(role=m.role, content=m.content))  # type: ignore
    messages.append(Message.user(prompt))

    response = client.chat(messages=messages)
    thinking = ""
    last_event = None
    async for event in response:
        last_event = event
        if event.type == LLMEventType.THINKING_COMPLETE:
            thinking = cast(str, event.content)

        await queue.put(event.to_dict())

    if last_event is None:
        raise ValueError("No events received from LLM client")

    end_time = time.perf_counter()
    token_count = last_event.total_tokens or 0
    user_message = await chat_repository.add_message(
        user_id=chat_session.info.user_id,
        session_id=chat_session.info.id,
        message=NewMessage(
            role="user",
            content=prompt,
            token_count=len(prompt),
            parent_message_id=chat_session.messages[-1].id
            if chat_session.messages
            else None,
        ),
        child_message=NewMessage(
            role="assistant",
            token_count=token_count,
            content=last_event.content or "",
            thinking=thinking,
        ),
        session=session,
    )

    user_msg_model = MessageModel.model_validate(user_message)
    ai_message_model = MessageModel.model_validate(user_message.active_child)
    chat_session.messages.append(user_msg_model)
    chat_session.messages.append(ai_message_model)
    await queue.put(
        {
            "type": "STREAM_END",
            "tokens_per_second": (token_count / (end_time - start_time)),
            "content": json.dumps(
                [
                    user_msg_model.model_dump(mode="json"),
                    ai_message_model.model_dump(mode="json"),
                ]
            ),
        }
    )
