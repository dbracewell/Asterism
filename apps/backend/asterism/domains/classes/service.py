"""Class lifecycle and membership.

Every educator path checks the live grant and ownership, so another educator's
class is a 404. A join code that is wrong, disabled or blocked for this student
gives one error, so it cannot be used to probe classes.
"""

import secrets
import time
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import BadDataException, ConflictException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.db.mixins import get_unix_timestamp
from asterism.db.queries import paginate_select
from asterism.domains.courses.storage import course_storage_keys, remove_course_bytes

from .educators import require_educator
from .models import ClassMemberModel, ClassModel
from .queries import select_joined_classes, select_taught_classes
from .schemas import (
    ClassCreate,
    ClassMember,
    ClassMemberPage,
    ClassUpdate,
    JoinedClass,
    JoinedClassPage,
    TaughtClass,
    TaughtClassPage,
)

logger = get_logger("Classes")

# No 0/O or 1/I, because codes get read aloud and copied from a board.
JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
JOIN_CODE_LENGTH = 10
INVALID_CODE = "That class code isn't valid. Check it with your educator."
NAME_TAKEN = "You already have a class with this name"
TOO_MANY_ATTEMPTS = "Too many wrong codes. Try again in a few minutes."
JOIN_FAILURE_LIMIT = 10
JOIN_FAILURE_WINDOW_SECONDS = 15 * 60

# Per-process, per-user; enough to stop guessing, without new storage.
_join_failures: dict[str, list[float]] = {}


def _recent_failures(user_id: str, now: float) -> list[float]:
    recent = [at for at in _join_failures.get(user_id, []) if now - at < JOIN_FAILURE_WINDOW_SECONDS]
    if recent:
        _join_failures[user_id] = recent
    else:
        _join_failures.pop(user_id, None)
    return recent


def _refuse_code(user_id: str) -> BadDataException:
    _join_failures.setdefault(user_id, []).append(time.monotonic())
    return BadDataException(INVALID_CODE)


def clear_join_failures() -> None:
    _join_failures.clear()


def new_join_code() -> str:
    return "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))


def normalize_join_code(code: str) -> str:
    return "".join(character for character in code.upper() if character.isalnum())


async def _member_count(class_id: uuid.UUID, session: AsyncSession) -> int:
    count = await session.scalar(
        select(func.count())
        .select_from(ClassMemberModel)
        .where(ClassMemberModel.class_id == class_id, ClassMemberModel.removed_at.is_(None))
    )
    return count or 0


async def _taught(row: ClassModel, session: AsyncSession) -> TaughtClass:
    view = TaughtClass.model_validate(row)
    view.member_count = await _member_count(row.id, session)
    return view


async def owned_class(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> ClassModel:
    await require_educator(user_id, session)
    row = await session.scalar(select_taught_classes(user_id).where(ClassModel.id == class_id))
    if row is None:
        raise NotFoundException("Class not found")
    return row


async def _commit_named(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictException(NAME_TAKEN) from exc


async def create_class(user: AuthedUser, payload: ClassCreate, session: AsyncSession) -> TaughtClass:
    await require_educator(user.id, session)
    row = ClassModel(
        educator_id=user.id,
        educator_name=user.name or "",
        name=payload.name,
        description=payload.description,
        join_code=new_join_code(),
    )
    session.add(row)
    await _commit_named(session)
    logger.info(f"Educator {user.id} created class {row.id}")
    return await _taught(row, session)


async def list_taught(user_id: str, session: AsyncSession, *, page: int, page_size: int) -> TaughtClassPage:
    await require_educator(user_id, session)
    result = await paginate_select(
        statement=select_taught_classes(user_id).order_by(ClassModel.name, ClassModel.id),
        session=session,
        page=page,
        page_size=page_size,
    )
    return TaughtClassPage(
        items=[await _taught(row, session) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def read_taught(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> TaughtClass:
    return await _taught(await owned_class(user_id, class_id, session), session)


async def update_class(user_id: str, class_id: uuid.UUID, payload: ClassUpdate, session: AsyncSession) -> TaughtClass:
    row = await owned_class(user_id, class_id, session)
    for field, value in payload.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(row, field, value)
    await _commit_named(session)
    return await _taught(row, session)


async def rotate_join_code(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> TaughtClass:
    row = await owned_class(user_id, class_id, session)
    row.join_code = new_join_code()
    await session.commit()
    logger.info(f"Educator {user_id} rotated the join code of class {class_id}")
    return await _taught(row, session)


async def delete_class(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> None:
    row = await owned_class(user_id, class_id, session)
    keys = await course_storage_keys(class_id, session)
    await session.delete(row)
    await session.commit()
    remove_course_bytes(user_id, keys)
    logger.info(f"Educator {user_id} deleted class {class_id}")


async def list_members(
    user_id: str, class_id: uuid.UUID, session: AsyncSession, *, page: int, page_size: int
) -> ClassMemberPage:
    await owned_class(user_id, class_id, session)
    result = await paginate_select(
        statement=select(ClassMemberModel)
        .where(ClassMemberModel.class_id == class_id)
        .order_by(ClassMemberModel.removed_at.is_not(None), ClassMemberModel.display_name, ClassMemberModel.user_id),
        session=session,
        page=page,
        page_size=page_size,
    )
    return ClassMemberPage(
        items=[ClassMember.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def _member(class_id: uuid.UUID, student_id: str, session: AsyncSession) -> ClassMemberModel:
    row = await session.get(ClassMemberModel, (class_id, student_id))
    if row is None:
        raise NotFoundException("Student not found in this class")
    return row


async def remove_member(user_id: str, class_id: uuid.UUID, student_id: str, session: AsyncSession) -> None:
    await owned_class(user_id, class_id, session)
    row = await _member(class_id, student_id, session)
    row.removed_at = row.removed_at or get_unix_timestamp()
    await session.commit()
    logger.info(f"Educator {user_id} removed {student_id} from class {class_id}")


async def allow_back(user_id: str, class_id: uuid.UUID, student_id: str, session: AsyncSession) -> None:
    """Clear a removal so the student can rejoin with the code. It does not re-add them."""
    await owned_class(user_id, class_id, session)
    row = await _member(class_id, student_id, session)
    if row.removed_at is None:
        raise BadDataException("This student has not been removed")
    await session.delete(row)
    await session.commit()


async def join_class(user: AuthedUser, code: str, session: AsyncSession) -> JoinedClass:
    if len(_recent_failures(user.id, time.monotonic())) >= JOIN_FAILURE_LIMIT:
        raise BadDataException(TOO_MANY_ATTEMPTS)
    row = await session.scalar(select(ClassModel).where(ClassModel.join_code == normalize_join_code(code)))
    if row is None or not row.join_enabled:
        raise _refuse_code(user.id)
    if row.educator_id == user.id:
        raise BadDataException("You run this class, so you can't join it as a student")
    member = await session.get(ClassMemberModel, (row.id, user.id))
    if member is not None and member.removed_at is not None:
        raise _refuse_code(user.id)
    if member is None:
        session.add(ClassMemberModel(class_id=row.id, user_id=user.id, display_name=user.name or "Student"))
        try:
            await session.commit()
        except IntegrityError:
            # Joined twice at once; the other request already added them.
            await session.rollback()
        logger.info(f"User {user.id} joined class {row.id}")
    return JoinedClass.model_validate(row)


async def list_joined(user_id: str, session: AsyncSession, *, page: int, page_size: int) -> JoinedClassPage:
    result = await paginate_select(
        statement=select_joined_classes(user_id).order_by(ClassModel.name, ClassModel.id),
        session=session,
        page=page,
        page_size=page_size,
    )
    return JoinedClassPage(
        items=[JoinedClass.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def leave_class(user_id: str, class_id: uuid.UUID, session: AsyncSession) -> None:
    """A removal is the educator's to clear, so leaving cannot erase it."""
    changed = await session.execute(
        delete(ClassMemberModel)
        .where(
            ClassMemberModel.class_id == class_id,
            ClassMemberModel.user_id == user_id,
            ClassMemberModel.removed_at.is_(None),
        )
        .returning(ClassMemberModel.user_id)
    )
    if changed.scalar_one_or_none() is None:
        raise NotFoundException("Class not found")
    await session.commit()
