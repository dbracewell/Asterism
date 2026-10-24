"""Authenticated, owner-scoped persona lifecycle."""

import uuid

from fastapi import APIRouter, Query

from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep
from asterism.domains.user.dependencies import AuthedUserDep

from . import personas
from .persona_schemas import PersonaCollection, PersonaDefaultUpdate, PersonaInput, PersonaProfile, PersonaUpdate

persona_router = APIRouter(
    prefix="/users/personas",
    tags=["User Personas"],
    responses={404: {"model": ErrorDetail}, 409: {"model": ErrorDetail}},
)


@persona_router.get("", operation_id="userPersonaList", response_model=PersonaCollection)
async def list_personas(user: AuthedUserDep, db: DBSessionDep):
    return await personas.list_personas(user_id=user.id, session=db)


@persona_router.post("", operation_id="userPersonaCreate", response_model=PersonaProfile)
async def create_persona(payload: PersonaInput, user: AuthedUserDep, db: DBSessionDep):
    return await personas.create_persona(user_id=user.id, payload=payload, session=db)


@persona_router.put("/default", operation_id="userPersonaSetDefault", response_model=PersonaCollection)
async def default_persona(payload: PersonaDefaultUpdate, user: AuthedUserDep, db: DBSessionDep):
    return await personas.change_default_persona(user_id=user.id, payload=payload, session=db)


@persona_router.get("/{persona_id}", operation_id="userPersonaGet", response_model=PersonaProfile)
async def get_persona(persona_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep):
    return await personas.get_persona(user_id=user.id, persona_id=persona_id, session=db)


@persona_router.patch("/{persona_id}", operation_id="userPersonaUpdate", response_model=PersonaProfile)
async def update_persona(persona_id: uuid.UUID, payload: PersonaUpdate, user: AuthedUserDep, db: DBSessionDep):
    return await personas.update_persona(user_id=user.id, persona_id=persona_id, payload=payload, session=db)


@persona_router.delete("/{persona_id}", operation_id="userPersonaDelete", response_model=PersonaCollection)
async def delete_persona(
    persona_id: uuid.UUID, user: AuthedUserDep, db: DBSessionDep, expected_revision: int = Query(ge=1)
):
    return await personas.delete_persona(
        user_id=user.id,
        persona_id=persona_id,
        expected_revision=expected_revision,
        session=db,
    )
