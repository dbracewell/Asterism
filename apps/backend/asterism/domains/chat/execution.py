"""Persisted execution snapshots distinguish a resumed turn from regeneration."""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException, NotFoundException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.execution_scope import ChatScopeSnapshot, ProjectScopeSnapshot
from asterism.domains.agent.prompts import PromptSnapshot
from asterism.domains.agent.schemas import AgentProfile, MainAgentConfiguration
from asterism.domains.agent.service import get_main_agent_profile
from asterism.domains.skills.activation import validate_snapshots
from asterism.domains.user.personas import require_owned_persona

from .execution_context import build_execution_provenance
from .execution_models import ChatExecutionModel
from .model_selection import require_chat_model
from .models import ChatModel, MessageModel
from .personas import read_chat_persona_snapshot
from .prompt_composition import build_prompt_snapshot
from .queries import select_owned_messages
from .schemas import MessageExecution
from .scope import read_chat_scope_snapshot, read_project_scope_snapshot


async def prepare_execution(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    restart: bool = False,
    session: AsyncSession | None = None,
    chat_snapshot: ChatScopeSnapshot | None = None,
    project_snapshot: ProjectScopeSnapshot | None = None,
) -> MessageExecution:
    async with get_async_db_session(session) as session:
        try:
            # Job start has already acquired the process-local run guard; the write
            # lock keeps the selection/configuration read and snapshot atomic.
            chat = await session.scalar(
                update(ChatModel)
                .where(ChatModel.id == chat_id, ChatModel.user_id == user_id)
                .values(updated_at=ChatModel.updated_at)
                .returning(ChatModel)
                .execution_options(populate_existing=True),
            )
            message = await session.scalar(
                select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id),
            )
            if chat is None or message is None:
                raise NotFoundException("Chat turn not found")
            current = MainAgentConfiguration.model_validate(await get_main_agent_profile(user_id, session))
            recorded = message.pending_execution
            if recorded is not None and not restart:
                await validate_recorded_execution(recorded, current, session, user_id=user_id)
                validate_prompt_snapshot(recorded, message.pending_prompt, chat.project_id)
                if (
                    recorded.context is None
                    or recorded.context.chat_id != chat_id
                    or recorded.context.user_id != user_id
                    or recorded.context.execution_id != recorded.id
                    or recorded.context.request_message_id != message_id
                    or recorded.request_message_id != message_id
                ):
                    raise CodedException(409, "Recorded source context is unavailable or changed; regenerate")
                execution = recorded
            else:
                if chat.selected_model_id is None:
                    raise CodedException(409, "Choose a chat model before generating")
                choice = await require_chat_model(chat.selected_model_id, user_id, session)
                chat_snap = chat_snapshot or await read_chat_scope_snapshot(
                    user_id=user_id, chat_id=chat_id, session=session
                )
                project_snap = (
                    project_snapshot
                    if project_snapshot is not None
                    else (
                        await read_project_scope_snapshot(
                            user_id=user_id, project_id=chat_snap.project_id, session=session
                        )
                        if chat_snap.project_id
                        else None
                    )
                )
                persona = (
                    await read_chat_persona_snapshot(user_id=user_id, chat_id=chat_id, session=session)
                    if restart
                    else message.accepted_persona
                )
                if persona is None:
                    raise CodedException(409, "Accepted persona input is unavailable; regenerate")
                try:
                    await require_owned_persona(user_id=user_id, persona_id=persona.id, session=session)
                except NotFoundException as error:
                    raise CodedException(409, "Accepted persona is unavailable; regenerate") from error
                skills = message.accepted_skills.snapshots
                await validate_snapshots(user_id, skills, session)
                prompt = await build_prompt_snapshot(
                    skills=skills,
                    persona_snapshot=persona,
                    user_id=user_id,
                    chat_id=chat_id,
                    profile=AgentProfile.model_validate(
                        {**current.model_dump(exclude_none=True), "sub_agent": False, "model_id": None}
                    ),
                    model_id=choice.id,
                    session=session,
                    chat_snapshot=chat_snap,
                    project_snapshot=project_snap,
                )
                execution = MessageExecution(
                    skills=[item.identity for item in skills],
                    persona=persona.identity,
                    prompt=prompt.provenance,
                    request_message_id=message_id,
                    model=choice,
                    model_revision=chat.model_revision,
                    configuration=current,
                )
                execution.context = await build_execution_provenance(
                    user_id=user_id,
                    chat_id=chat_id,
                    execution=execution,
                    session=session,
                    chat_snapshot=chat_snap,
                    project_snapshot=project_snap,
                )
                record = ChatExecutionModel(
                    id=execution.id,
                    user_id=user_id,
                    chat_id=chat_id,
                    request_message_id=message_id,
                    execution=execution,
                    prompt=prompt,
                )
                session.add(record)
                await session.flush()
                message.pending_execution_id = record.id
                await session.flush()
                await session.refresh(message, ["pending_execution_record"])
            await session.commit()
            return execution.model_copy(deep=True)
        except BaseException:
            await session.rollback()
            raise


async def validate_recorded_execution(
    recorded: MessageExecution,
    current: MainAgentConfiguration,
    session: AsyncSession,
    *,
    user_id: str,
):
    try:
        await require_owned_persona(user_id=user_id, persona_id=recorded.persona.id, session=session)
    except NotFoundException as error:
        raise CodedException(409, "Recorded persona is unavailable; regenerate with an available persona") from error
    from .skills import recorded_skill_snapshots

    snapshots = await recorded_skill_snapshots(user_id=user_id, execution=recorded, session=session)
    await validate_snapshots(user_id, snapshots, session)
    choice = await require_chat_model(recorded.model.id, user_id, session)
    if (
        choice.name != recorded.model.name
        or choice.provider_id != recorded.model.provider_id
        or choice.supports_tools != recorded.model.supports_tools
        or choice.supports_vision != recorded.model.supports_vision
        or choice.context_window != recorded.model.context_window
    ):
        raise CodedException(409, "Recorded model identity changed; regenerate with the current selection")
    if not set(recorded.configuration.tools) <= set(current.tools):
        raise CodedException(409, "Recorded capabilities changed; regenerate with current settings")
    return choice


async def read_execution_prompt(*, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID) -> PromptSnapshot:
    async with get_async_db_session() as session:
        message = await session.scalar(
            select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id)
        )
        if message is None or message.pending_prompt is None:
            raise NotFoundException("Recorded prompt not found")
        return message.pending_prompt


def validate_prompt_snapshot(
    execution: MessageExecution,
    snapshot: PromptSnapshot | None,
    project_id: uuid.UUID | None,
) -> None:
    if snapshot is None or snapshot.provenance != execution.prompt:
        raise CodedException(409, "Recorded prompt is unavailable or changed; regenerate")
    if snapshot.project_id != project_id:
        raise CodedException(409, "Recorded prompt project changed; regenerate")

    profile_layers = [layer for layer in snapshot.layers if layer.kind == "profile"]
    if len(profile_layers) != 1 or (
        profile_layers[0].source_id != str(execution.persona.id)
        or profile_layers[0].revision != execution.persona.revision
        or execution.context is None
        or execution.context.user_profile_id != execution.persona.id
        or execution.context.user_profile_revision != execution.persona.revision
    ):
        raise CodedException(409, "Recorded persona input is unavailable or changed; regenerate")
