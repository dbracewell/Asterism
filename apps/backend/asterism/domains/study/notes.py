"""Saved study notes: summaries and study guides (US-53.6, ADR-0037).

A note exists only after the learner saves a draft. Every operation first
proves project ownership, then note membership in that project; foreign and
missing notes are indistinguishable 404s. Bodies are untrusted Markdown.
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import NotFoundException
from asterism.db.queries import paginate_select
from asterism.domains.projects.scope import require_owned_project

from .citations import resolve_citations, serialize_citations
from .llm import visible_model_name
from .models import StudyNoteModel
from .queries import select_owned_notes
from .schemas import StudyNote, StudyNoteCreate, StudyNotePage, StudyNoteSummary, StudyNoteUpdate

logger = get_logger("StudyNotes")


async def require_note(
    *, user_id: str, project_id: uuid.UUID, note_id: uuid.UUID, session: AsyncSession
) -> StudyNoteModel:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    note = await session.scalar(
        select_owned_notes(user_id=user_id, project_id=project_id).where(StudyNoteModel.id == note_id)
    )
    if note is None:
        raise NotFoundException("Note not found")
    return note


def _summary(row: StudyNoteModel) -> StudyNoteSummary:
    return StudyNoteSummary(
        id=row.id,
        project_id=row.project_id,
        kind=row.kind,  # pyright: ignore[reportArgumentType]  # DB check constraint pins the values.
        title=row.title,
        model_name=row.model_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _to_note(*, user_id: str, row: StudyNoteModel, session: AsyncSession) -> StudyNote:
    citations = await resolve_citations(
        user_id=user_id, project_id=row.project_id, stored=[row.citations], session=session
    )
    return StudyNote(**_summary(row).model_dump(), body=row.body, citations=citations[0], model_id=row.model_id)


async def list_notes(
    *, user_id: str, project_id: uuid.UUID, page: int, page_size: int, session: AsyncSession
) -> StudyNotePage:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    result = await paginate_select(
        statement=select_owned_notes(user_id=user_id, project_id=project_id).order_by(
            StudyNoteModel.updated_at.desc(), StudyNoteModel.id
        ),
        session=session,
        page=page,
        page_size=page_size,
    )
    return StudyNotePage(
        items=[_summary(row) for row in result.records], total=result.total, page=page, page_size=page_size
    )


async def read_note(*, user_id: str, project_id: uuid.UUID, note_id: uuid.UUID, session: AsyncSession) -> StudyNote:
    note = await require_note(user_id=user_id, project_id=project_id, note_id=note_id, session=session)
    return await _to_note(user_id=user_id, row=note, session=session)


async def create_note(
    *, user_id: str, project_id: uuid.UUID, payload: StudyNoteCreate, session: AsyncSession
) -> StudyNote:
    await require_owned_project(user_id=user_id, project_id=project_id, session=session)
    citations = await serialize_citations(
        user_id=user_id, project_id=project_id, citations=payload.citations, session=session
    )
    model_name = (
        await visible_model_name(user_id=user_id, model_id=payload.model_id, session=session)
        if payload.model_id is not None
        else None
    )
    note = StudyNoteModel(
        user_id=user_id,
        project_id=project_id,
        kind=payload.kind,
        title=payload.title,
        body=payload.body,
        citations=citations,
        model_id=payload.model_id,
        model_name=model_name,
    )
    session.add(note)
    await session.commit()
    logger.info(f"Saved study note {note.id} ({payload.kind}) in project {project_id} for user {user_id}")
    return await _to_note(user_id=user_id, row=note, session=session)


async def update_note(
    *, user_id: str, project_id: uuid.UUID, note_id: uuid.UUID, payload: StudyNoteUpdate, session: AsyncSession
) -> StudyNote:
    note = await require_note(user_id=user_id, project_id=project_id, note_id=note_id, session=session)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(note, field, value)
    await session.commit()
    return await _to_note(user_id=user_id, row=note, session=session)


async def delete_note(*, user_id: str, project_id: uuid.UUID, note_id: uuid.UUID, session: AsyncSession) -> None:
    await require_note(user_id=user_id, project_id=project_id, note_id=note_id, session=session)
    await session.execute(
        delete(StudyNoteModel).where(
            StudyNoteModel.id == note_id,
            StudyNoteModel.user_id == user_id,
            StudyNoteModel.project_id == project_id,
        )
    )
    await session.commit()
    logger.info(f"Deleted study note {note_id} in project {project_id} for user {user_id}")
