import asyncio
import json
import time
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.data.models import (
    ChatSessionModel,
    ChatSessionUpdate,
    MessageModel,
    NewMessage,
)
from asterism.core.data.repositories import chat_repository
from asterism.core.data.schemas.events import ChatSessionUpdateEvent
from asterism.core.llm.client import LLMClient
from asterism.core.llm.typedefs import LLMEvent, LLMEventType, Message
from asterism.core.utils.callback import post_callback

client = LLMClient(
    api_key="abc",
    llm_host="http://localhost:1234/v1",
    model_name="qwen/qwen3.6-35b-a3b",
)


async def generate(
    chat_session: ChatSessionModel,
    prompt: str,
    queue: asyncio.Queue,
    session: AsyncSession,
):
    if chat_session.info.title is None or chat_session.info.title == "New Chat":
        messages = [
            Message.user(f"""
You are an expert summarization system. 
Generate a short, descriptive title for a chat session based on the user's initial prompt. 
Keep the title between 3 to 6 words and use Title Case. 
Output ONLY the title, with no quotation marks, punctuation, or additional text.
User prompt: {prompt}
"""),  # noqa: E501
        ]
        response = client.chat(messages=messages)
        last_event: LLMEvent = LLMEvent.empty()
        async for event in response:
            last_event = event
        title = last_event.content
        chat_session.info.title = title or "New Chat"
        await chat_repository.update(
            user_id=chat_session.info.user_id,
            session_id=chat_session.info.id,
            update=ChatSessionUpdate(title=chat_session.info.title),
            session=session,
        )
        post_callback(
            event_type="chat-session:update",
            payload=ChatSessionUpdateEvent(
                session_id=chat_session.info.id,
                title=chat_session.info.title,
            ),
            user_id=chat_session.info.user_id,
        )

    start_time = time.perf_counter()
    messages: list[Message] = []
    for m in chat_session.messages:
        messages.append(Message(role=m.role, content=m.content))  # type: ignore
    messages.append(Message.user(prompt))

    response = client.chat(messages=messages)
    thinking = ""
    last_event: LLMEvent = LLMEvent.empty()
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
