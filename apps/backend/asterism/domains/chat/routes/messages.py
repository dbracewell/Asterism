"""Message routes: sending, editing, comparing, verifying and forking messages, and their recorded runs."""

import uuid

from fastapi import APIRouter, Path

import asterism.domains.chat.service as chat_service
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from ..disagreement_schemas import DisagreementRequest, DisagreementSummary
from ..draft_comment_schemas import DraftCommentSummary, DraftCommentUpdate, DraftReview
from ..exercise_schemas import ExerciseAttemptRequest, ExerciseView
from ..schemas import (
    ChatComparison,
    ChatSendRequest,
    ContextLayerTexts,
    ForkInstructions,
    Message,
    MessageCompareRequest,
    MessageForkRequest,
    RecordedRun,
    UpdateMessageRequest,
)
from ..verification_schemas import MessageVerification, VerifyRequest

router = APIRouter()


@router.patch(
    "/{chat_id}/message/{message_id}",
    operation_id="messageUpdate",
    response_model=Message,
)
async def update_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: UpdateMessageRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Message:
    return await chat_service.update_message(
        user_id=user.id,
        chat_id=chat_id,
        message_id=message_id,
        payload=payload,
        session=db,
    )


@router.post(
    "/{chat_id}/message",
    response_model=Message,
    operation_id="chatMessageSend",
    responses={409: {"model": ErrorDetail}},
)
async def send_message(chat_id: uuid.UUID, payload: ChatSendRequest, user: AuthedUserDep, db: DBSessionDep) -> Message:
    from ..sending import send_message

    return await send_message(user_id=user.id, chat_id=chat_id, payload=payload, session=db)


@router.post(
    "/{chat_id}/message/{message_id}/compare",
    response_model=ChatComparison,
    operation_id="chatMessageCompare",
    responses={400: {"model": ErrorDetail}, 409: {"model": ErrorDetail}},
)
async def compare_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: MessageCompareRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ChatComparison:
    """Make an answered turn column 0 of a comparison and queue the other targets."""
    from ..comparisons import compare_existing

    return await compare_existing(user_id=user.id, chat_id=chat_id, message_id=message_id, payload=payload, session=db)


@router.get(
    "/{chat_id}/messages/{message_id}/context/layers",
    response_model=ContextLayerTexts,
    operation_id="chatContextLayersGet",
)
async def get_context_layers(
    chat_id: uuid.UUID, message_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> ContextLayerTexts:
    """The prompt layer text a recorded assistant step used; owner only."""
    from ..context_inspection import read_context_layers

    return await read_context_layers(user_id=user.id, chat_id=chat_id, message_id=message_id, session=db)


@router.get(
    "/{chat_id}/messages/{message_id}/run",
    response_model=RecordedRun,
    operation_id="chatRunGet",
)
async def get_run(chat_id: uuid.UUID, message_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> RecordedRun:
    """The recorded run a message belongs to, on its own branch; owner only (US-54.6)."""
    from ..runs import read_run

    return await read_run(user_id=user.id, chat_id=chat_id, message_id=message_id, session=db)


@router.post(
    "/{chat_id}/messages/{message_id}/exercise/attempts",
    response_model=ExerciseView,
    operation_id="chatExerciseAttempt",
)
async def attempt_exercise(
    chat_id: uuid.UUID, message_id: uuid.UUID, payload: ExerciseAttemptRequest, user: AuthedUserDep, db: DBSessionDep
) -> ExerciseView:
    """Check whether a selection is the exercise's deliberate error; owner only (US-55.4)."""
    from ..exercises import record_attempt

    return await record_attempt(user_id=user.id, chat_id=chat_id, message_id=message_id, request=payload, session=db)


@router.post(
    "/{chat_id}/messages/{message_id}/exercise/reveal",
    response_model=ExerciseView,
    operation_id="chatExerciseReveal",
)
async def reveal_exercise(
    chat_id: uuid.UUID, message_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> ExerciseView:
    """Show the exercise's error, its correction and the source; owner only (US-55.4)."""
    from ..exercises import reveal

    return await reveal(user_id=user.id, chat_id=chat_id, message_id=message_id, session=db)


@router.get(
    "/{chat_id}/messages/{message_id}/draft-review",
    response_model=DraftReview,
    operation_id="chatDraftReviewGetOne",
)
async def read_draft_review(
    chat_id: uuid.UUID, message_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> DraftReview:
    """The draft a feedback reply assessed, with its inline comments anchored; owner only (US-57.2)."""
    from ..draft_comments import read_draft_review

    return await read_draft_review(user_id=user.id, chat_id=chat_id, message_id=message_id, session=db)


@router.put(
    "/{chat_id}/messages/{message_id}/draft-review/comments/{comment_id}",
    response_model=DraftCommentSummary,
    operation_id="chatDraftReviewCommentUpdate",
)
async def update_draft_comment(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: DraftCommentUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
    comment_id: str = Path(pattern=r"^c[0-9]{1,3}$"),
) -> DraftCommentSummary:
    """Mark an inline comment resolved or open again; owner only (US-57.2)."""
    from ..draft_comments import set_resolved

    return await set_resolved(
        user_id=user.id,
        chat_id=chat_id,
        message_id=message_id,
        comment_id=comment_id,
        resolved=payload.resolved,
        session=db,
    )


@router.post(
    "/{chat_id}/messages/{message_id}/disagreements",
    response_model=DisagreementSummary,
    operation_id="chatDelegationDisagreementsFind",
)
async def find_delegation_disagreements(
    chat_id: uuid.UUID, message_id: uuid.UUID, payload: DisagreementRequest, user: AuthedUserDep, db: DBSessionDep
) -> DisagreementSummary:
    """List where a step's sub-agent results disagree; owner only (US-55.3)."""
    from ..disagreements import compare_delegations

    return await compare_delegations(
        user_id=user.id, chat_id=chat_id, message_id=message_id, request=payload, session=db
    )


@router.post(
    "/{chat_id}/messages/{message_id}/verify",
    response_model=MessageVerification,
    operation_id="chatMessageVerify",
)
async def verify_message(
    chat_id: uuid.UUID, message_id: uuid.UUID, payload: VerifyRequest, user: AuthedUserDep, db: DBSessionDep
) -> MessageVerification:
    """Check an answer's claims against its sources and store the labels; owner only (US-55.2)."""
    from ..verification import verify_message

    return await verify_message(user_id=user.id, chat_id=chat_id, message_id=message_id, request=payload, session=db)


@router.get(
    "/{chat_id}/messages/{message_id}/fork/instructions",
    response_model=ForkInstructions,
    operation_id="chatForkInstructionsGet",
)
async def get_fork_instructions(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    delegation_execution_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> ForkInstructions:
    """The sub-agent instructions a fork of this delegation starts from; owner only."""
    from ..forks import read_fork_instructions

    return await read_fork_instructions(
        user_id=user.id,
        chat_id=chat_id,
        message_id=message_id,
        delegation_execution_id=delegation_execution_id,
        session=db,
    )


@router.post(
    "/{chat_id}/messages/{message_id}/fork",
    response_model=Message,
    operation_id="chatMessageFork",
    responses={409: {"model": ErrorDetail}},
)
async def fork_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    payload: MessageForkRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> Message:
    """Fork a recorded run at one delegation; the client then resumes the chat (ADR-0038)."""
    from ..forks import accept_fork

    return await accept_fork(user_id=user.id, chat_id=chat_id, message_id=message_id, payload=payload, session=db)
