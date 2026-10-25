"""Branch-local skill state and authorized composition, owned by chat."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import CodedException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.skill_inputs import AcceptedSkills, SkillSnapshot
from asterism.domains.skills.activation import eligible_rows, validate_limits, validate_snapshots

from .branches import active_branch
from .models import ChatModel, MessageModel
from .queries import select_owned_messages
from .schemas import ActiveSkill, ActiveSkillState, MessageExecution, SkillSelection


async def branch_skills(user_id: str, chat_id: uuid.UUID, session: AsyncSession) -> AcceptedSkills:
    records = list(await session.scalars(select_owned_messages(user_id=user_id, chat_id=chat_id)))
    by_id = {row.id: row for row in records}
    for message in reversed(active_branch(records)):
        if message.role == "user":
            return by_id[message.id].accepted_skills
    return AcceptedSkills()


async def accept_skills(
    *, user_id: str, chat: ChatModel, selection: SkillSelection | None, session: AsyncSession
) -> AcceptedSkills:
    previous = await branch_skills(user_id, chat.id, session)
    if selection is None:
        await validate_snapshots(user_id, previous.snapshots, session)
        return previous
    if selection.expected_revision != previous.revision:
        raise CodedException(409, "Active skill state changed; reload before sending")
    ids = selection.skill_ids
    refresh = set(selection.refresh_ids)
    if len(ids) != len(set(ids)) or len(refresh) != len(selection.refresh_ids) or not refresh <= set(ids):
        raise CodedException(422, "Skill selections must be unique; refresh IDs must be selected")
    rows = await eligible_rows(user_id, ids, session)
    pinned = {item.id: item for item in previous.snapshots}
    snapshots = tuple(
        pinned[identity]
        if identity in pinned and identity not in refresh
        else SkillSnapshot(
            id=identity, name=rows[identity].name, revision=rows[identity].revision, content=rows[identity].content
        )
        for identity in ids
    )
    validate_limits(snapshots)
    chat.skill_revision += 1
    return AcceptedSkills(revision=chat.skill_revision, snapshots=snapshots)


async def describe_skills(user_id: str, state: AcceptedSkills, session: AsyncSession) -> ActiveSkillState:
    # Unavailable metadata stays visible so the composer can explicitly remove it.
    from asterism.domains.skills.models import SkillModel
    from asterism.domains.skills.queries import select_owned_skills

    rows = {
        row.id: row
        for row in await session.scalars(
            select_owned_skills(user_id).where(SkillModel.id.in_([item.id for item in state.snapshots]))
        )
    }
    result = []
    for item in state.snapshots:
        try:
            await validate_snapshots(user_id, (item,), session)
            available = True
        except CodedException:
            available = False
        row = rows.get(item.id)
        result.append(
            ActiveSkill(
                **item.identity.model_dump(),
                available=available,
                update_available=row is not None and row.revision != item.revision,
            )
        )
    return ActiveSkillState(revision=state.revision, skills=result)


async def recorded_skill_snapshots(
    *, user_id: str, execution: MessageExecution, session: AsyncSession
) -> tuple[SkillSnapshot, ...]:
    message = (
        await session.scalar(
            select_owned_messages(user_id=user_id, chat_id=execution.context.chat_id).where(
                MessageModel.id == execution.request_message_id
            )
        )
        if execution.context is not None
        else None
    )
    if message is None:
        raise CodedException(409, "Recorded skill inputs are unavailable; regenerate")
    snapshots = message.accepted_skills.snapshots
    if [item.identity for item in snapshots] != execution.skills:
        raise CodedException(409, "Recorded skill inputs changed; regenerate")
    return snapshots


async def validate_execution_skills(*, user_id: str, execution: MessageExecution) -> None:
    async with get_async_db_session() as session:
        snapshots = await recorded_skill_snapshots(user_id=user_id, execution=execution, session=session)
        await validate_snapshots(user_id, snapshots, session)


async def inherited_skills(
    *, user_id: str, chat_id: uuid.UUID, parent_id: uuid.UUID | None, session: AsyncSession
) -> AcceptedSkills:
    """A fork inherits its source ancestry, never a sibling's selected state."""
    visited: set[uuid.UUID] = set()
    while parent_id is not None:
        if parent_id in visited:
            raise CodedException(409, "Invalid message ancestry")
        visited.add(parent_id)
        parent = await session.scalar(
            select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == parent_id)
        )
        if parent is None:
            raise CodedException(409, "Source branch is unavailable")
        if parent.role == "user":
            return parent.accepted_skills
        parent_id = parent.parent_message_id
    return AcceptedSkills()
