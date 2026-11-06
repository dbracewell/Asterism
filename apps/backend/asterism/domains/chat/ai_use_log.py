"""Builds the AI-use log from recorded provenance (US-57.4, ADR-0046).

Each selected chat contributes its active branch: every user turn with the
mode, persona, template, rubric, skills and files it was sent with, and the
reply that answered it (model, tools, cited files, exercise label,
verification counts). The log is owner scoped; one foreign or missing chat
rejects the whole request. Selecting individual turns and rendering happen in
the client.
"""

import time
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.domains.projects.models import ProjectModel
from asterism.domains.projects.queries import select_owned_projects

from .ai_use_log_schemas import (
    AiUseLog,
    AiUseLogRequest,
    LoggedChat,
    LoggedFile,
    LoggedReply,
    LoggedTemplate,
    LoggedTurn,
    LoggedVerification,
)
from .schemas import Message, MessageVerification


def _verification(record: MessageVerification | None) -> LoggedVerification | None:
    if record is None:
        return None
    labels = [claim.label for claim in record.claims]
    return LoggedVerification(
        model=record.model_name,
        # Verify passes record milliseconds; the log uses Unix seconds throughout.
        at=record.created_at // 1000,
        supported=labels.count("supported"),
        unsupported=labels.count("unsupported"),
        contradicted=labels.count("contradicted"),
        unchecked=labels.count("unchecked"),
    )


def _reply(steps: Sequence[Message]) -> LoggedReply | None:
    if not steps:
        return None
    final = steps[-1]
    tools = list(dict.fromkeys(call.function.name for step in steps for call in step.tool_calls or ()))
    cited = list(
        dict.fromkeys(
            citation.name
            for step in steps
            for citation in step.citations
            if citation.available and citation.name is not None
        )
    )
    return LoggedReply(
        message_id=final.id,
        at=final.created_at,
        status=final.status.value,
        model=final.execution.model.name if final.execution else None,
        tools=tools,
        cited_files=cited,
        exercise=any(step.exercise is not None for step in steps),
        verification=_verification(final.verification),
        draft_comments=final.draft_comment_summary,
    )


def _turn(request: Message, steps: Sequence[Message]) -> LoggedTurn:
    execution = next((step.execution for step in steps if step.execution), None)
    return LoggedTurn(
        message_id=request.id,
        at=request.created_at,
        prompt=request.content,
        learning_mode=request.learning_mode,
        persona=execution.persona.name if execution else None,
        template=(
            LoggedTemplate(
                name=request.template.name, level=request.template.level, available=request.template.available
            )
            if request.template
            else None
        ),
        rubric=request.rubric.document.name if request.rubric else None,
        goal=request.goal.text if request.goal else None,
        skills=[skill.name for skill in request.skills],
        files=[LoggedFile(name=file.name, available=file.available) for file in request.files],
        compared=request.comparison_id is not None,
        reply=_reply(steps),
    )


def turns(messages: Sequence[Message]) -> list[LoggedTurn]:
    """Pair each user turn on the branch with the assistant steps that answered it."""
    result: list[LoggedTurn] = []
    request: Message | None = None
    steps: list[Message] = []
    for message in messages:
        if message.role == "user":
            if request is not None:
                result.append(_turn(request, steps))
            request, steps = message, []
        elif message.role == "assistant" and request is not None:
            steps.append(message)
    if request is not None:
        result.append(_turn(request, steps))
    return result


async def build_log(*, user_id: str, request: AiUseLogRequest, session: AsyncSession) -> AiUseLog:
    from .service import get_one

    chats: list[LoggedChat] = []
    projects: dict[uuid.UUID, str | None] = {}
    for chat_id in request.chat_ids:
        chat = await get_one(chat_id, user_id, session)
        project_id = chat.info.project_id
        if project_id is not None and project_id not in projects:
            projects[project_id] = await session.scalar(
                select_owned_projects(user_id=user_id)
                .where(ProjectModel.id == project_id)
                .with_only_columns(ProjectModel.name)
            )
        chats.append(
            LoggedChat(
                chat_id=chat.info.id,
                title=chat.info.title,
                project=projects.get(project_id) if project_id else None,
                created_at=chat.info.created_at,
                turns=turns(chat.messages),
            )
        )
    return AiUseLog(generated_at=int(time.time()), chats=chats)
