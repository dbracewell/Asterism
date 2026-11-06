"""Authenticated study routes under one owned project (ADR-0033, ADR-0035).

Foreign or missing projects, decks, cards, quizzes and attempts all return 404.
"""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import (
    attempts,
    generation,
    mastery,
    notes,
    quiz_generation,
    quizzes,
    review,
    service,
    study_guides,
    summaries,
    unclear,
    weak_spots,
)
from .schemas import (
    MAX_REVIEW_QUEUE,
    MAX_WEAK_SPOTS,
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
    StudyGuideDraft,
    StudyGuideRequest,
    StudyNote,
    StudyNoteCreate,
    StudyNotePage,
    StudyNoteUpdate,
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
    StudySummaryDraft,
    StudySummaryRequest,
    StudyTopicMasteryList,
    StudyTopicPracticeRequest,
    StudyUnclearCardCreate,
    StudyWeakSpotPracticeRequest,
    StudyWeakSpots,
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


# --- Weak spots (US-53.5, ADR-0036) ------------------------------------------


@study_router.get("/weak-spots", operation_id="studyWeakSpotGetMany")
async def list_weak_spots(
    project_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    response: Response,
    limit: int = Query(default=20, ge=1, le=MAX_WEAK_SPOTS),
) -> StudyWeakSpots:
    """Questions and cards whose latest outcome was a miss, most recent first."""
    response.headers["Cache-Control"] = "no-store"
    return await weak_spots.list_weak_spots(user_id=user.id, project_id=project_id, limit=limit, session=db)


@study_router.post("/weak-spots/practice", operation_id="studyWeakSpotPractice", status_code=201)
async def practice_weak_spots(
    project_id: uuid.UUID, payload: StudyWeakSpotPracticeRequest, user: AuthedUserDep, db: DBSessionDep
) -> StudyQuiz:
    """Save a quiz that re-asks the most recent weak spots; 400 when there are none."""
    return await weak_spots.practice_weak_spots(user_id=user.id, project_id=project_id, request=payload, session=db)


# --- Topic mastery (US-58.3, ADR-0049) ----------------------------------------


@study_router.get("/topics", operation_id="studyTopicMasteryGetMany")
async def list_topic_mastery(
    project_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep, response: Response
) -> StudyTopicMasteryList:
    """Mastery per deck and quiz tag, derived from review ratings and quiz results."""
    response.headers["Cache-Control"] = "no-store"
    return await mastery.topic_mastery(user_id=user.id, project_id=project_id, session=db)


@study_router.post("/topics/practice", operation_id="studyTopicPractice", status_code=201)
async def practice_topic(
    project_id: uuid.UUID, payload: StudyTopicPracticeRequest, user: AuthedUserDep, db: DBSessionDep
) -> StudyQuiz:
    """Save a quiz of one topic's weakest items; 404 for an unknown topic."""
    return await mastery.practice_topic(user_id=user.id, project_id=project_id, request=payload, session=db)


# --- Unclear items (US-58.4, ADR-0050) -----------------------------------------


@study_router.post("/unclear-cards", operation_id="studyUnclearCardCreate", status_code=201)
async def create_unclear_card(
    project_id: uuid.UUID, payload: StudyUnclearCardCreate, user: AuthedUserDep, db: DBSessionDep
) -> StudyCard:
    """Create one card the learner confirmed from a reflection's unclear items."""
    return await unclear.create_unclear_card(user_id=user.id, project_id=project_id, payload=payload, session=db)


# --- Notes, summaries and study guides (US-53.6, ADR-0037) ---------------------


@study_router.get("/notes", operation_id="studyNoteGetMany")
async def list_notes(
    project_id: uuid.UUID,
    user: AuthedUserDep,
    db: DBSessionDep,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> StudyNotePage:
    """Notes, most recently updated first."""
    return await notes.list_notes(user_id=user.id, project_id=project_id, page=page, page_size=page_size, session=db)


@study_router.post("/notes", operation_id="studyNoteCreate", status_code=201)
async def create_note(
    project_id: uuid.UUID, payload: StudyNoteCreate, user: AuthedUserDep, db: DBSessionDep
) -> StudyNote:
    """Save a summary or study guide draft as a note."""
    return await notes.create_note(user_id=user.id, project_id=project_id, payload=payload, session=db)


@study_router.get("/notes/{note_id}", operation_id="studyNoteGetOne")
async def get_note(project_id: uuid.UUID, note_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> StudyNote:
    return await notes.read_note(user_id=user.id, project_id=project_id, note_id=note_id, session=db)


@study_router.patch("/notes/{note_id}", operation_id="studyNoteUpdate")
async def update_note(
    project_id: uuid.UUID, note_id: uuid.UUID, payload: StudyNoteUpdate, user: AuthedUserDep, db: DBSessionDep
) -> StudyNote:
    return await notes.update_note(user_id=user.id, project_id=project_id, note_id=note_id, payload=payload, session=db)


@study_router.delete("/notes/{note_id}", operation_id="studyNoteDelete", status_code=204)
async def delete_note(project_id: uuid.UUID, note_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep) -> Response:
    await notes.delete_note(user_id=user.id, project_id=project_id, note_id=note_id, session=db)
    return Response(status_code=204)


@study_router.post("/summaries", operation_id="studySummaryGenerate", responses={409: {"model": ErrorDetail}})
async def summarize(
    project_id: uuid.UUID, payload: StudySummaryRequest, user: AuthedUserDep, db: DBSessionDep, response: Response
) -> StudySummaryDraft:
    """Draft a cited summary of project files; nothing is saved."""
    response.headers["Cache-Control"] = "no-store"
    return await summaries.summarize(user_id=user.id, project_id=project_id, request=payload, session=db)


@study_router.post(
    "/study-guides",
    operation_id="studyGuideGenerate",
    responses={409: {"model": ErrorDetail}, 502: {"model": ErrorDetail}, 504: {"model": ErrorDetail}},
)
async def plan_study_guide(
    project_id: uuid.UUID, payload: StudyGuideRequest, user: AuthedUserDep, db: DBSessionDep, response: Response
) -> StudyGuideDraft:
    """Draft a day-by-day plan to the exam date, linked to decks and quizzes; nothing is saved."""
    response.headers["Cache-Control"] = "no-store"
    return await study_guides.plan_study_guide(user_id=user.id, project_id=project_id, request=payload, session=db)
