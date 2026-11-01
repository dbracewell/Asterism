"""Authenticated study routes under one owned project (ADR-0033, ADR-0035).

Foreign or missing projects, decks, cards, quizzes and attempts all return 404.
"""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import attempts, generation, quiz_generation, quizzes, review, service
from .schemas import (
    MAX_REVIEW_QUEUE,
    StudyCard,
    StudyCardCreate,
    StudyCardDraftBatch,
    StudyCardDraftRequest,
    StudyCardPage,
    StudyCardUpdate,
    StudyDeck,
    StudyDeckCreate,
    StudyDeckPage,
    StudyDeckUpdate,
    StudyProjectSummary,
    StudyQuiz,
    StudyQuizAttempt,
    StudyQuizAttemptPage,
    StudyQuizAttemptRequest,
    StudyQuizGenerateRequest,
    StudyQuizGeneration,
    StudyQuizPage,
    StudyQuizUpdate,
    StudyReviewCard,
    StudyReviewQueue,
    StudyReviewRequest,
)

study_router = APIRouter(
    prefix="/projects/{project_id}/study",
    tags=["study"],
    responses={400: {"model": ErrorDetail}, 401: {"model": ErrorDetail}, 404: {"model": ErrorDetail}},
)


@study_router.get("/decks", operation_id="studyDeckGetMany")
async def list_decks(
    project_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> StudyDeckPage:
    return await service.list_decks(user_id=user.id, project_id=project_id, page=page, page_size=page_size, session=db)


@study_router.post("/decks", operation_id="studyDeckCreate", status_code=201)
async def create_deck(
    project_id: uuid.UUID, payload: StudyDeckCreate, user: AuthedUserDep, db: DBSessionDep
) -> StudyDeck:
    return await service.create_deck(user_id=user.id, project_id=project_id, payload=payload, session=db)


@study_router.get("/decks/{deck_id}", operation_id="studyDeckGetOne")
async def get_deck(project_id: uuid.UUID, deck_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> StudyDeck:
    return await service.read_deck(user_id=user.id, project_id=project_id, deck_id=deck_id, session=db)


@study_router.patch("/decks/{deck_id}", operation_id="studyDeckUpdate")
async def update_deck(
    project_id: uuid.UUID, deck_id: uuid.UUID, payload: StudyDeckUpdate, user: AuthedUserDep, db: DBSessionDep
) -> StudyDeck:
    return await service.update_deck(
        user_id=user.id, project_id=project_id, deck_id=deck_id, payload=payload, session=db
    )


@study_router.delete("/decks/{deck_id}", operation_id="studyDeckDelete", status_code=204)
async def delete_deck(project_id: uuid.UUID, deck_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> Response:
    await service.delete_deck(user_id=user.id, project_id=project_id, deck_id=deck_id, session=db)
    return Response(status_code=204)


@study_router.get("/decks/{deck_id}/cards", operation_id="studyCardGetMany")
async def list_cards(
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> StudyCardPage:
    return await service.list_cards(
        user_id=user.id, project_id=project_id, deck_id=deck_id, page=page, page_size=page_size, session=db
    )


@study_router.post("/decks/{deck_id}/cards", operation_id="studyCardCreate", status_code=201)
async def create_card(
    project_id: uuid.UUID, deck_id: uuid.UUID, payload: StudyCardCreate, user: AuthedUserDep, db: DBSessionDep
) -> StudyCard:
    return await service.create_card(
        user_id=user.id, project_id=project_id, deck_id=deck_id, payload=payload, session=db
    )


@study_router.get("/decks/{deck_id}/cards/{card_id}", operation_id="studyCardGetOne")
async def get_card(
    project_id: uuid.UUID, deck_id: uuid.UUID, card_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> StudyCard:
    return await service.read_card(user_id=user.id, project_id=project_id, deck_id=deck_id, card_id=card_id, session=db)


@study_router.patch("/decks/{deck_id}/cards/{card_id}", operation_id="studyCardUpdate")
async def update_card(
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    card_id: uuid.UUID,
    payload: StudyCardUpdate,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> StudyCard:
    return await service.update_card(
        user_id=user.id, project_id=project_id, deck_id=deck_id, card_id=card_id, payload=payload, session=db
    )


@study_router.delete("/decks/{deck_id}/cards/{card_id}", operation_id="studyCardDelete", status_code=204)
async def delete_card(
    project_id: uuid.UUID, deck_id: uuid.UUID, card_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> Response:
    await service.delete_card(user_id=user.id, project_id=project_id, deck_id=deck_id, card_id=card_id, session=db)
    return Response(status_code=204)


@study_router.post(
    "/decks/{deck_id}/card-drafts",
    operation_id="studyCardDraftGenerate",
    responses={409: {"model": ErrorDetail}},
)
async def generate_card_drafts(
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    payload: StudyCardDraftRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
    response: Response,
) -> StudyCardDraftBatch:
    """Draft cards from project files for review; nothing is saved (ADR-0034)."""
    response.headers["Cache-Control"] = "no-store"
    return await generation.generate_card_drafts(
        user_id=user.id, project_id=project_id, deck_id=deck_id, request=payload, session=db
    )


@study_router.get("/summary", operation_id="studyProjectSummaryGet")
async def get_summary(project_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> StudyProjectSummary:
    return await service.project_summary(user_id=user.id, project_id=project_id, session=db)


@study_router.get("/decks/{deck_id}/review", operation_id="studyReviewQueueGet")
async def get_review_queue(
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    response: Response,
    limit: int = Query(default=100, ge=1, le=MAX_REVIEW_QUEUE),
) -> StudyReviewQueue:
    """Due cards in due order with the next due time for each rating."""
    response.headers["Cache-Control"] = "no-store"
    return await review.review_queue(user_id=user.id, project_id=project_id, deck_id=deck_id, limit=limit, session=db)


@study_router.post(
    "/decks/{deck_id}/cards/{card_id}/reviews",
    operation_id="studyCardReview",
    responses={409: {"model": ErrorDetail}},
)
async def rate_card(
    project_id: uuid.UUID,
    deck_id: uuid.UUID,
    card_id: uuid.UUID,
    payload: StudyReviewRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> StudyReviewCard:
    """Rate recall; 409 when the card was already rated since it was shown."""
    return await review.rate_card(
        user_id=user.id, project_id=project_id, deck_id=deck_id, card_id=card_id, payload=payload, session=db
    )


# --- Practice quizzes (US-53.4, ADR-0035) -----------------------------------


@study_router.get("/quizzes", operation_id="studyQuizGetMany")
async def list_quizzes(
    project_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> StudyQuizPage:
    return await quizzes.list_quizzes(
        user_id=user.id, project_id=project_id, page=page, page_size=page_size, session=db
    )


@study_router.post("/quizzes", operation_id="studyQuizGenerate", responses={409: {"model": ErrorDetail}})
async def generate_quiz(
    project_id: uuid.UUID, payload: StudyQuizGenerateRequest, user: AuthedUserDep, db: DBSessionDep
) -> StudyQuizGeneration:
    """Write and save a quiz from project files; ``quiz`` is null when no question was usable."""
    return await quiz_generation.generate_quiz(user_id=user.id, project_id=project_id, request=payload, session=db)


@study_router.get("/quizzes/{quiz_id}", operation_id="studyQuizGetOne")
async def get_quiz(project_id: uuid.UUID, quiz_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> StudyQuiz:
    """The quiz to take: questions without answer keys or sources."""
    return await quizzes.read_quiz(user_id=user.id, project_id=project_id, quiz_id=quiz_id, session=db)


@study_router.patch("/quizzes/{quiz_id}", operation_id="studyQuizUpdate")
async def update_quiz(
    project_id: uuid.UUID, quiz_id: uuid.UUID, payload: StudyQuizUpdate, user: AuthedUserDep, db: DBSessionDep
) -> StudyQuiz:
    return await quizzes.update_quiz(
        user_id=user.id, project_id=project_id, quiz_id=quiz_id, payload=payload, session=db
    )


@study_router.delete("/quizzes/{quiz_id}", operation_id="studyQuizDelete", status_code=204)
async def delete_quiz(project_id: uuid.UUID, quiz_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> Response:
    await quizzes.delete_quiz(user_id=user.id, project_id=project_id, quiz_id=quiz_id, session=db)
    return Response(status_code=204)


@study_router.get("/quizzes/{quiz_id}/attempts", operation_id="studyQuizAttemptGetMany")
async def list_attempts(
    project_id: uuid.UUID,
    quiz_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> StudyQuizAttemptPage:
    """Attempts, newest first."""
    return await attempts.list_attempts(
        user_id=user.id, project_id=project_id, quiz_id=quiz_id, page=page, page_size=page_size, session=db
    )


@study_router.post(
    "/quizzes/{quiz_id}/attempts",
    operation_id="studyQuizAttemptSubmit",
    status_code=201,
    responses={409: {"model": ErrorDetail}},
)
async def submit_attempt(
    project_id: uuid.UUID,
    quiz_id: uuid.UUID,
    payload: StudyQuizAttemptRequest,
    user: AuthedUserDep,
    db: DBSessionDep,
) -> StudyQuizAttempt:
    """Grade and save an attempt; returns the results with answer keys and sources."""
    return await attempts.submit_attempt(
        user_id=user.id, project_id=project_id, quiz_id=quiz_id, payload=payload, session=db
    )


@study_router.get("/quizzes/{quiz_id}/attempts/{attempt_id}", operation_id="studyQuizAttemptGetOne")
async def get_attempt(
    project_id: uuid.UUID, quiz_id: uuid.UUID, attempt_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep
) -> StudyQuizAttempt:
    return await attempts.read_attempt(
        user_id=user.id, project_id=project_id, quiz_id=quiz_id, attempt_id=attempt_id, session=db
    )
