"""Persona documents and default pointer mutations; owner locking serializes writes."""

import uuid

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException, NotFoundException

from .models import PersonaProfileModel, UserModel
from .persona_schemas import PersonaCollection, PersonaDefaultUpdate, PersonaInput, PersonaProfile, PersonaUpdate
from .queries import select_owned_personas


async def require_owned_persona(*, user_id: str, persona_id: uuid.UUID, session: AsyncSession) -> PersonaProfileModel:
    persona = await session.scalar(select_owned_personas(user_id=user_id).where(PersonaProfileModel.id == persona_id))
    if persona is None:
        raise NotFoundException("Persona not found")
    return persona


async def require_persona_access(*, user_id: str, persona_id: uuid.UUID, session: AsyncSession) -> None:
    exists = await session.scalar(
        select_owned_personas(user_id=user_id)
        .with_only_columns(PersonaProfileModel.id)
        .where(PersonaProfileModel.id == persona_id)
    )
    if exists is None:
        raise NotFoundException("Persona not found")


async def _require_user(user_id: str, session: AsyncSession) -> UserModel:
    user = await session.get(UserModel, user_id, populate_existing=True)
    if user is None:
        raise NotFoundException("User not found")
    return user


async def _lock_user(user_id: str, session: AsyncSession) -> UserModel:
    user = await session.scalar(
        update(UserModel)
        .where(UserModel.id == user_id)
        .values(id=UserModel.id)
        .returning(UserModel)
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise NotFoundException("User not found")
    return user


def _response(persona: PersonaProfileModel, user: UserModel) -> PersonaProfile:
    return PersonaProfile(
        id=persona.id,
        name=persona.name,
        user_md=persona.user_md,
        revision=persona.revision,
        created_at=persona.created_at,
        updated_at=persona.updated_at,
        is_default=persona.id == user.default_persona_id,
    )


async def list_personas(*, user_id: str, session: AsyncSession) -> PersonaCollection:
    # Read the pointer, its revision and bounded collection in one SQL snapshot.
    rows = (
        await session.execute(
            select_owned_personas(user_id=user_id)
            .add_columns(UserModel.default_persona_id, UserModel.persona_revision)
            .join(UserModel, UserModel.id == PersonaProfileModel.user_id)
            .order_by(PersonaProfileModel.created_at, PersonaProfileModel.id)
            .execution_options(populate_existing=True)
        )
    ).all()
    if not rows:
        raise NotFoundException("User not found")
    default_id, default_revision = rows[0][1], rows[0][2]
    return PersonaCollection(
        profiles=[
            PersonaProfile(
                id=row.id,
                name=row.name,
                user_md=row.user_md,
                revision=row.revision,
                created_at=row.created_at,
                updated_at=row.updated_at,
                is_default=row.id == default_id,
            )
            for row, _, _ in rows
        ],
        default_persona_id=default_id,
        default_revision=default_revision,
    )


async def get_persona(*, user_id: str, persona_id: uuid.UUID, session: AsyncSession) -> PersonaProfile:
    row = await require_owned_persona(user_id=user_id, persona_id=persona_id, session=session)
    return _response(row, await _require_user(user_id, session))


async def create_persona(*, user_id: str, payload: PersonaInput, session: AsyncSession) -> PersonaProfile:
    try:
        user = await _lock_user(user_id, session)
        persona = PersonaProfileModel(user_id=user_id, name=payload.name, user_md=payload.user_md)
        session.add(persona)
        await session.flush()
        response = _response(persona, user)
        await session.commit()
        return response
    except IntegrityError as error:
        await session.rollback()
        raise ConflictException("Persona name already exists or the twenty-persona limit was reached") from error
    except BaseException:
        await session.rollback()
        raise


async def update_persona(
    *,
    user_id: str,
    persona_id: uuid.UUID,
    payload: PersonaUpdate,
    session: AsyncSession,
) -> PersonaProfile:
    try:
        user = await _lock_user(user_id, session)
        await require_owned_persona(user_id=user_id, persona_id=persona_id, session=session)
        row = await session.scalar(
            update(PersonaProfileModel)
            .where(
                PersonaProfileModel.id == persona_id,
                PersonaProfileModel.user_id == user_id,
                PersonaProfileModel.revision == payload.expected_revision,
            )
            .values(name=payload.name, user_md=payload.user_md, revision=PersonaProfileModel.revision + 1)
            .returning(PersonaProfileModel)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ConflictException("Persona changed; reload and retry")
        response = _response(row, user)
        await session.commit()
        return response
    except IntegrityError as error:
        await session.rollback()
        raise ConflictException("A persona with that name already exists") from error
    except BaseException:
        await session.rollback()
        raise


async def change_default_persona(
    *,
    user_id: str,
    payload: PersonaDefaultUpdate,
    session: AsyncSession,
) -> PersonaCollection:
    try:
        user = await _lock_user(user_id, session)
        await require_owned_persona(user_id=user_id, persona_id=payload.persona_id, session=session)
        if user.persona_revision != payload.expected_default_revision:
            raise ConflictException("Default persona changed; reload and retry")
        if user.default_persona_id != payload.persona_id:
            user.default_persona_id = payload.persona_id
            user.persona_revision += 1
        await session.flush()
        result = await list_personas(user_id=user_id, session=session)
        await session.commit()
        return result
    except BaseException:
        await session.rollback()
        raise


async def delete_persona(
    *,
    user_id: str,
    persona_id: uuid.UUID,
    expected_revision: int,
    session: AsyncSession,
) -> PersonaCollection:
    try:
        user = await _lock_user(user_id, session)
        row = await require_owned_persona(user_id=user_id, persona_id=persona_id, session=session)
        if user.default_persona_id == persona_id:
            raise ConflictException("Choose another default before deleting this persona")
        if row.revision != expected_revision:
            raise ConflictException("Persona changed; reload and retry")
        await session.execute(
            delete(PersonaProfileModel).where(
                PersonaProfileModel.id == persona_id,
                PersonaProfileModel.user_id == user_id,
                PersonaProfileModel.revision == expected_revision,
            )
        )
        result = await list_personas(user_id=user_id, session=session)
        await session.commit()
        return result
    except IntegrityError as error:
        await session.rollback()
        raise ConflictException(
            "This persona is selected by a chat; change those selections before deleting it"
        ) from error
    except BaseException:
        await session.rollback()
        raise
