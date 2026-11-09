"""Model-written SKILL.md drafts (ADR-0061).

A draft is a hidden chat with ``purpose="skill_draft"``. The main agent writes
under a fixed task layer; the draft is read back from its latest reply and
validated with the same parser skill create uses. Nothing here saves a skill.
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException

from .documents import parse_document
from .policy import require_drafting_enabled
from .schemas import SkillDraft, SkillDraftStart
from .writer import extract_skill_block


def opening_prompt(payload: SkillDraftStart) -> str:
    prompt = f"Write a skill for this:\n\n{payload.description.strip()}"
    if payload.examples and payload.examples.strip():
        prompt += f"\n\nExamples of how it should work:\n\n{payload.examples.strip()}"
    return prompt


async def start_draft(user_id: str, payload: SkillDraftStart, session: AsyncSession):
    """Start a drafting chat; streaming and cancel use the chat WebSocket."""
    from asterism.domains.chat.schemas import NewChatRequest
    from asterism.domains.chat.sending import create_chat

    await require_drafting_enabled(session)
    return await create_chat(
        user_id,
        NewChatRequest(
            request_id=payload.request_id,
            model_id=payload.model_id,
            persona_id=payload.persona_id,
            user_prompt=opening_prompt(payload),
        ),
        session,
        purpose="skill_draft",
    )


async def read_draft(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> SkillDraft:
    """The draft in the latest reply on the active branch, validated like skill create."""
    from asterism.domains.chat.branches import active_branch
    from asterism.domains.chat.models import ChatModel
    from asterism.domains.chat.queries import select_owned_chats, select_owned_messages
    from asterism.domains.chat.schemas import MessageStatus

    await require_drafting_enabled(session)
    chat = await session.scalar(
        select_owned_chats(user_id=user_id).where(ChatModel.id == chat_id, ChatModel.purpose == "skill_draft")
    )
    if chat is None:
        raise NotFoundException("Skill draft not found")
    branch = active_branch(
        list(await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat_id))), chat.active_root_id
    )
    reply = next((message for message in reversed(branch) if message.role == "assistant"), None)
    if branch and branch[-1].role == "user" and branch[-1].status == MessageStatus.PENDING:
        return SkillDraft(chat_id=chat_id, status="pending")
    if reply is None:
        return SkillDraft(chat_id=chat_id, status="none")
    if reply.status == MessageStatus.PENDING:
        return SkillDraft(chat_id=chat_id, status="pending", message_id=reply.id)
    content = extract_skill_block(reply.content)
    if content is None:
        return SkillDraft(
            chat_id=chat_id,
            status="invalid",
            message_id=reply.id,
            error="The reply has no ```skill block with a SKILL.md document",
        )
    try:
        metadata = parse_document(content)
    except BadDataException as error:
        return SkillDraft(chat_id=chat_id, status="invalid", message_id=reply.id, content=content, error=str(error))
    return SkillDraft(
        chat_id=chat_id,
        status="ready",
        message_id=reply.id,
        content=content,
        name=metadata.name,
        description=metadata.description,
    )
