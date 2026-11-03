"""Inline comments on a learner's draft (US-57.2, ADR-0045).

When a Draft feedback reply is saved, each quoted passage and the note below
it becomes a comment with a stable ID. The draft view anchors comments when it
is read, against the documents the feedback turn sent (the message text and
its attached text files, rechecked against live chat scope). Comments whose
quote cannot be found are returned without an anchor. Learners mark comments
resolved; nothing here changes the reply or the draft.
"""

import time
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException, NotFoundException
from asterism.domains.files.models import FileContentStatus, FileKind, UserFileModel
from asterism.domains.files.queries import select_owned_files
from asterism.domains.learning.catalog import RUBRIC_FEEDBACK
from asterism.domains.learning.rubric_replies import parse_rubric_reply

from .draft_comment_schemas import (
    MAX_COMMENTS,
    MAX_NOTE_CHARS,
    MAX_QUOTE_CHARS,
    DraftAnchor,
    DraftComment,
    DraftComments,
    DraftCommentSummary,
    DraftCommentView,
    DraftDocument,
    DraftReview,
    comment_summary,
)
from .models import MessageModel
from .queries import select_owned_messages
from .schemas import MessageExecution

MESSAGE_DOCUMENT = "message"
_MIN_QUOTE_CHARS = 3
_MIN_FRAGMENT_CHARS = 12
_EQUIVALENT = str.maketrans({"“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "..."})
_SKIPPED = frozenset("*_`")
_QUOTES = " \"'"
_EDGE = " .,;:!?\"'"


def build_comments(content: str, execution: MessageExecution | None) -> DraftComments | None:
    """The comments of a rubric feedback reply, or None for any other reply."""
    if execution is None or execution.rubric is None:
        return None
    reply = parse_rubric_reply(
        content,
        levels=execution.rubric.levels,
        criteria=execution.rubric.criteria,
        level_label=RUBRIC_FEEDBACK.level_label,
        overall_heading=RUBRIC_FEEDBACK.overall_heading,
    )
    if reply is None:
        return None
    comments: list[DraftComment] = []
    for section in reply.criteria:
        for pair in section.notes:
            if len(comments) >= MAX_COMMENTS:
                break
            comments.append(
                DraftComment(
                    id=f"c{len(comments) + 1}",
                    criterion=section.criterion,
                    level=section.level[:80] if section.level else None,
                    quote=pair.quote[:MAX_QUOTE_CHARS],
                    note=pair.note[:MAX_NOTE_CHARS],
                )
            )
    return DraftComments(comments=comments) if comments else None


def _normalized(text: str) -> tuple[str, list[int]]:
    """Text folded for matching, with each kept character's index in the original.

    Whitespace runs collapse to one space, typographic quotes and dashes match
    their ASCII forms, case is ignored and emphasis marks are skipped.
    """
    chars: list[str] = []
    origin: list[int] = []
    for index, char in enumerate(text):
        if char in _SKIPPED:
            continue
        mapped = char.translate(_EQUIVALENT)
        if char.isspace():
            if not chars or chars[-1] == " ":
                continue
            mapped = " "
        for piece in mapped:
            lowered = piece.lower()
            chars.append(lowered if len(lowered) == 1 else piece)
            origin.append(index)
    return "".join(chars), origin


def _utf16(text: str, index: int) -> int:
    return len(text[:index].encode("utf-16-le")) // 2


def _candidates(quote: str) -> list[str]:
    """The quote as written, then without edge punctuation, then its longest fragment around an ellipsis."""
    folded = _normalized(quote)[0]
    whole, bare = folded.strip(_QUOTES), folded.strip(_EDGE)
    if len(bare) < _MIN_QUOTE_CHARS:
        return []
    fragments = sorted((part.strip(_EDGE) for part in bare.split("...")), key=len, reverse=True)
    extra = [fragments[0]] if "..." in bare and len(fragments[0]) >= _MIN_FRAGMENT_CHARS else []
    return list(dict.fromkeys([whole, bare, *extra]))


def anchor_quote(quote: str, documents: Sequence[DraftDocument]) -> DraftAnchor | None:
    """The first place, document by document, where the quote occurs."""
    candidates = _candidates(quote)
    for document in documents:
        if not document.available or not document.text:
            continue
        folded, origin = _normalized(document.text)
        for candidate in candidates:
            position = folded.find(candidate)
            if position < 0:
                continue
            start = origin[position]
            end = origin[position + len(candidate) - 1] + 1
            return DraftAnchor(
                document_id=document.id,
                start=_utf16(document.text, start),
                end=_utf16(document.text, end),
            )
    return None


async def _owned_reply(
    *, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession, lock: bool = False
) -> tuple[MessageModel, DraftComments]:
    statement = select_owned_messages(user_id=user_id, chat_id=chat_id).where(MessageModel.id == message_id)
    row = await session.scalar(statement.with_for_update() if lock else statement)
    if row is None:
        raise NotFoundException("Message not found")
    if row.draft_comments is None:
        raise BadDataException("This message has no draft comments")
    return row, row.draft_comments


async def _documents(*, user_id: str, chat_id: uuid.UUID, turn: MessageModel, session: AsyncSession):
    from .inline_files import read_live_file_ids

    documents = []
    if turn.content.strip():
        documents.append(
            DraftDocument(id=MESSAGE_DOCUMENT, kind="message", name="Your message", available=True, text=turn.content)
        )
    references = list(turn.files or [])
    if not references:
        return documents
    live = await read_live_file_ids(user_id=user_id, chat_id=chat_id, session=session)
    ids = [reference.file_id for reference in references if reference.file_id in live]
    rows = {
        row.id: row
        for row in await session.scalars(select_owned_files(user_id=user_id).where(UserFileModel.id.in_(ids)))
    }
    for reference in references:
        row = rows.get(reference.file_id)
        base = {"id": str(reference.file_id), "kind": "file", "name": reference.name}
        if row is None:
            documents.append(
                DraftDocument(**base, available=False, reason="This file is no longer available in this chat.")
            )
        elif row.kind == FileKind.IMAGE:
            documents.append(DraftDocument(**base, available=False, reason="Comments can't be shown on images."))
        elif row.content_status != FileContentStatus.READY or not row.content_cache:
            documents.append(DraftDocument(**base, available=False, reason="This file has no readable text."))
        else:
            documents.append(DraftDocument(**base, available=True, text=row.content_cache))
    return documents


async def read_draft_review(
    *, user_id: str, chat_id: uuid.UUID, message_id: uuid.UUID, session: AsyncSession
) -> DraftReview:
    """The draft the feedback turn sent, with each comment anchored where possible; owner only."""
    reply, record = await _owned_reply(user_id=user_id, chat_id=chat_id, message_id=message_id, session=session)
    execution = reply.execution
    turn = (
        await session.scalar(
            select_owned_messages(user_id=user_id, chat_id=chat_id).where(
                MessageModel.id == execution.request_message_id
            )
        )
        if execution is not None
        else None
    )
    documents = await _documents(user_id=user_id, chat_id=chat_id, turn=turn, session=session) if turn else []
    return DraftReview(
        documents=documents,
        comments=[
            DraftCommentView(
                id=comment.id,
                criterion=comment.criterion,
                level=comment.level,
                quote=comment.quote,
                note=comment.note,
                resolved=comment.resolved_at is not None,
                anchor=anchor_quote(comment.quote, documents),
            )
            for comment in record.comments
        ],
    )


async def set_resolved(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    comment_id: str,
    resolved: bool,
    session: AsyncSession,
) -> DraftCommentSummary:
    """Mark one comment resolved or open again; owner only and idempotent."""
    row, record = await _owned_reply(
        user_id=user_id, chat_id=chat_id, message_id=message_id, session=session, lock=True
    )
    if not any(comment.id == comment_id for comment in record.comments):
        raise NotFoundException("Comment not found")
    now = int(time.time() * 1000)
    row.draft_comments = DraftComments(
        comments=[
            comment.model_copy(update={"resolved_at": (comment.resolved_at or now) if resolved else None})
            if comment.id == comment_id
            else comment
            for comment in record.comments
        ]
    )
    await session.commit()
    summary = comment_summary(row.draft_comments)
    assert summary is not None
    return summary
