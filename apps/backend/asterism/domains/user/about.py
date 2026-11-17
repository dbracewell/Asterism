"""About you reads and revision-checked writes; the user row is the owner lock (ADR-0066)."""

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import ConflictException, NotFoundException
from asterism.domains.agent.prompts import AboutSnapshot

from .about_schemas import AboutYou, AboutYouUpdate
from .models import UserModel


async def read_about_snapshot(*, user_id: str, session: AsyncSession) -> AboutSnapshot:
    """The user's current About you text and revision, for pinning on a turn."""
    row = (
        await session.execute(
            select(UserModel.about_md, UserModel.about_revision)
            .where(UserModel.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).one_or_none()
    if row is None:
        raise NotFoundException("User not found")
    return AboutSnapshot(revision=row.about_revision, text=row.about_md)


async def get_about(*, user_id: str, session: AsyncSession) -> AboutYou:
    snapshot = await read_about_snapshot(user_id=user_id, session=session)
    return AboutYou(about_md=snapshot.text, revision=snapshot.revision)


async def update_about(*, user_id: str, payload: AboutYouUpdate, session: AsyncSession) -> AboutYou:
    """Replace the text when the revision still matches; an unchanged text keeps its revision."""
    try:
        current = await session.scalar(
            update(UserModel)
            .where(UserModel.id == user_id)
            .values(id=UserModel.id)
            .returning(UserModel)
            .execution_options(populate_existing=True)
        )
        if current is None:
            raise NotFoundException("User not found")
        if current.about_revision != payload.expected_revision:
            raise ConflictException("About you changed; reload and retry")
        if current.about_md != payload.about_md:
            current.about_md = payload.about_md
            current.about_revision += 1
            await session.flush()
        result = AboutYou(about_md=current.about_md, revision=current.about_revision)
        await session.commit()
        return result
    except BaseException:
        await session.rollback()
        raise
