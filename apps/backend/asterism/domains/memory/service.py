"""Owner-scoped memory lifecycle (ADR-0078).

Only the owner reads or changes a memory: a missing memory and another person's
look the same (404). Logs and errors name ids and kinds, never memory text,
because a memory may be sensitive.
"""

import uuid

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.knowledge.embedding import embedding_provider
from asterism.domains.projects.models import ProjectModel
from asterism.domains.projects.queries import select_owned_projects

from .models import MemoryKind, MemoryModel, MemorySavedBy
from .queries import count_owned_memories, filter_memories, order_memories, select_owned_memories
from .schemas import Memory, MemoryCreate, MemoryPage, MemorySource, MemoryUpdate
from .vectors import MemoryVector, memory_vector_store

logger = get_logger("Memory")

# At most this many user memories per person, and memories per person in each project.
MAX_MEMORIES_PER_SCOPE = 200


def to_memory(row: MemoryModel) -> Memory:
    return Memory(
        id=row.id,
        kind=row.kind,
        project_id=row.project_id,
        text=row.text,
        category=row.category,
        sensitive=row.sensitive,
        saved_by=row.saved_by,
        source=MemorySource(
            chat_id=row.source_chat_id,
            message_id=row.source_message_id,
            execution_id=row.source_execution_id,
            # A confirmed proposal always had a chat; an empty one means it was deleted.
            chat_deleted=row.saved_by == MemorySavedBy.AGENT and row.source_chat_id is None,
        ),
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def require_memory(user_id: str, memory_id: uuid.UUID, session: AsyncSession) -> MemoryModel:
    row = await session.scalar(select_owned_memories(user_id).where(MemoryModel.id == memory_id))
    if row is None:
        raise NotFoundException("Memory not found")
    return row


async def _require_project(user_id: str, project_id: uuid.UUID, session: AsyncSession) -> None:
    owned = await session.scalar(
        select_owned_projects(user_id=user_id).where(ProjectModel.id == project_id).with_only_columns(ProjectModel.id)
    )
    if owned is None:
        raise NotFoundException("Project not found")


async def write_vector(row: MemoryModel) -> bool:
    """Embed and store the memory's vector; False when it failed. Best effort: the row is the record."""
    try:
        [vector] = await embedding_provider.embed_text([row.text])
        await memory_vector_store.write(
            MemoryVector(
                memory_id=str(row.id),
                user_id=row.user_id,
                kind=row.kind.value,
                project_id=str(row.project_id) if row.project_id else "",
                revision=row.revision,
                vector=vector,
            )
        )
    except Exception as error:
        # No text in the message: the memory may be sensitive.
        logger.warning(f"Memory {row.id} saved without a vector ({type(error).__name__}); it will be rebuilt")
        return False
    return True


async def _delete_vectors(user_id: str, memory_ids: list[uuid.UUID]) -> None:
    try:
        await memory_vector_store.delete_memories(user_id=user_id, memory_ids=memory_ids)
    except Exception as error:
        logger.warning(f"Vectors of {len(memory_ids)} deleted memories were not removed ({type(error).__name__})")


async def read_memory(user_id: str, memory_id: uuid.UUID, session: AsyncSession) -> Memory:
    return to_memory(await require_memory(user_id, memory_id, session))


async def list_memories(
    user_id: str,
    session: AsyncSession,
    *,
    kind: MemoryKind | None,
    project_id: uuid.UUID | None,
    page: int,
    page_size: int,
) -> MemoryPage:
    statement = order_memories(filter_memories(select_owned_memories(user_id), kind=kind, project_id=project_id))
    result = await paginate_select(statement=statement, session=session, page=page, page_size=page_size)
    return MemoryPage(
        items=[to_memory(row) for row in result.records], total=result.total, page=page, page_size=page_size
    )


async def add_memory(row: MemoryModel, session: AsyncSession) -> None:
    """Check the project and the cap, then add the row; the caller commits and writes the vector."""
    if row.project_id is not None:
        await _require_project(row.user_id, row.project_id, session)
    count = await session.scalar(count_owned_memories(row.user_id, kind=row.kind, project_id=row.project_id))
    if (count or 0) >= MAX_MEMORIES_PER_SCOPE:
        where = "user memories" if row.kind == MemoryKind.USER else "memories in a project"
        raise ConflictException(f"You can keep at most {MAX_MEMORIES_PER_SCOPE} {where}; delete one first")
    session.add(row)
    await session.flush()


async def create_memory(user_id: str, payload: MemoryCreate, session: AsyncSession) -> Memory:
    """Save a memory the person wrote themselves."""
    row = MemoryModel(
        user_id=user_id,
        kind=payload.kind,
        project_id=payload.project_id,
        text=payload.text,
        category=payload.category,
        sensitive=payload.sensitive,
        saved_by=MemorySavedBy.PERSON,
    )
    await add_memory(row, session)
    await session.commit()
    await session.refresh(row)
    logger.info(f"Saved {row.kind.value} memory {row.id} for user {user_id}")
    await write_vector(row)
    return to_memory(row)


async def update_memory(user_id: str, memory_id: uuid.UUID, payload: MemoryUpdate, session: AsyncSession) -> Memory:
    current = await require_memory(user_id, memory_id, session)
    if current.kind == MemoryKind.USER and payload.category is None:
        raise BadDataException("A user memory needs a category")
    if current.kind == MemoryKind.PROJECT and payload.category is not None:
        raise BadDataException("A project memory has no category")
    result = await session.execute(
        update(MemoryModel)
        .where(
            MemoryModel.id == memory_id,
            MemoryModel.user_id == user_id,
            MemoryModel.revision == payload.expected_revision,
        )
        .values(
            text=payload.text,
            category=payload.category,
            sensitive=payload.sensitive,
            revision=MemoryModel.revision + 1,
        )
        .returning(MemoryModel.id)
        .execution_options(synchronize_session="fetch")
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Memory changed; reload before saving")
    await session.commit()
    row = await require_memory(user_id, memory_id, session)
    await session.refresh(row)
    logger.info(f"Updated memory {memory_id} for user {user_id}")
    await write_vector(row)
    return to_memory(row)


async def delete_memory(user_id: str, memory_id: uuid.UUID, expected_revision: int, session: AsyncSession) -> None:
    await require_memory(user_id, memory_id, session)
    result = await session.execute(
        delete(MemoryModel)
        .where(
            MemoryModel.id == memory_id,
            MemoryModel.user_id == user_id,
            MemoryModel.revision == expected_revision,
        )
        .returning(MemoryModel.id)
    )
    if result.scalar_one_or_none() is None:
        await session.rollback()
        raise ConflictException("Memory changed; reload before deleting")
    await session.commit()
    logger.info(f"Deleted memory {memory_id} for user {user_id}")
    await _delete_vectors(user_id, [memory_id])


async def delete_all_memories(
    user_id: str, session: AsyncSession, *, kind: MemoryKind | None, project_id: uuid.UUID | None
) -> int:
    """Delete every memory of the owner that matches; returns how many."""
    statement = delete(MemoryModel).where(MemoryModel.user_id == user_id)
    if kind is not None:
        statement = statement.where(MemoryModel.kind == kind)
    if project_id is not None:
        statement = statement.where(MemoryModel.project_id == project_id)
    deleted = list((await session.execute(statement.returning(MemoryModel.id))).scalars())
    await session.commit()
    logger.info(f"Deleted {len(deleted)} memories for user {user_id}")
    await _delete_vectors(user_id, deleted)
    return len(deleted)


async def forget_project_vectors(*, user_id: str, project_id: uuid.UUID) -> None:
    """Remove a deleted project's memory vectors; its rows went with the project."""
    try:
        await memory_vector_store.delete_project(user_id=user_id, project_id=project_id)
    except Exception as error:
        logger.warning(f"Memory vectors of deleted project {project_id} were not removed ({type(error).__name__})")
