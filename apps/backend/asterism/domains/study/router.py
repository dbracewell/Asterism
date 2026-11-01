"""Authenticated deck and card CRUD under one owned project (ADR-0033).

Foreign or missing projects, decks and cards all return 404.
"""

import uuid

from fastapi import APIRouter, Query, Response

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import service
from .schemas import (
    StudyCard,
    StudyCardCreate,
    StudyCardPage,
    StudyCardUpdate,
    StudyDeck,
    StudyDeckCreate,
    StudyDeckPage,
    StudyDeckUpdate,
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
