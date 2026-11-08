"""Educator access: a user asks, an administrator decides (ADR-0053, ADR-0058).

Access is membership of the educator group. Members of the admin group may also
run classes. A request row exists only while the request is pending.
"""

from collections.abc import Iterable
from typing import Literal

from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import ForbiddenException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.domains.groups import service as groups
from asterism.domains.groups.models import ADMIN_GROUP, EDUCATOR_GROUP, STUDENT_GROUP
from asterism.domains.user.models import UserModel

from .models import EducatorRequestModel
from .names import USER_FALLBACK
from .schemas import EducatorAccess, EducatorRequest, EducatorRequestPage

logger = get_logger("Educators")

# Groups whose members may run classes.
TEACHING_GROUPS = (EDUCATOR_GROUP, ADMIN_GROUP)


async def read_access(user_id: str, session: AsyncSession) -> EducatorAccess:
    if await groups.read_group_id(user_id, session) in TEACHING_GROUPS:
        return EducatorAccess(status="approved")
    pending = await session.get(EducatorRequestModel, user_id, populate_existing=True)
    return EducatorAccess(status="pending" if pending else "none")


async def read_statuses(user_ids: Iterable[str], session: AsyncSession) -> dict[str, Literal["pending", "approved"]]:
    """Educator status by user id: approved for the educator group, pending for a request; others absent."""
    wanted = set(user_ids)
    if not wanted:
        return {}
    rows = await session.execute(
        select(UserModel.id, UserModel.group_id, EducatorRequestModel.user_id)
        .outerjoin(EducatorRequestModel, EducatorRequestModel.user_id == UserModel.id)
        .where(UserModel.id.in_(wanted))
    )
    statuses: dict[str, Literal["pending", "approved"]] = {}
    for user_id, group_id, requested in rows:
        if group_id == EDUCATOR_GROUP:
            statuses[user_id] = "approved"
        elif requested is not None:
            statuses[user_id] = "pending"
    return statuses


async def require_educator(user_id: str, session: AsyncSession) -> None:
    """Checked live on every request, so moving someone out of the group stops it at once."""
    if (await read_access(user_id, session)).status != "approved":
        raise ForbiddenException("Educator access is required")


async def request_access(user: AuthedUser, session: AsyncSession) -> EducatorAccess:
    """Idempotent: asking again never changes a decision already made."""
    access = await read_access(user.id, session)
    if access.status == "none":
        session.add(EducatorRequestModel(user_id=user.id))
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
        access = await read_access(user.id, session)
    return access


def _select_requests():
    """Pending requests first, then the educator group, each oldest first."""
    approved = UserModel.group_id == EDUCATOR_GROUP
    return (
        select(UserModel, EducatorRequestModel.created_at)
        .outerjoin(EducatorRequestModel, EducatorRequestModel.user_id == UserModel.id)
        .where(or_(approved, EducatorRequestModel.user_id.is_not(None)))
        .order_by(
            case((approved, 1), else_=0),
            func.coalesce(EducatorRequestModel.created_at, UserModel.created_at),
            UserModel.id,
        )
    )


def _view(user: UserModel, requested_at: int | None) -> EducatorRequest:
    """Only administrators see the requester's live name and email."""
    return EducatorRequest(
        user_id=user.id,
        status="approved" if user.group_id == EDUCATOR_GROUP else "pending",
        display_name=user.name or USER_FALLBACK,
        email=user.email,
        created_at=requested_at or user.created_at,
    )


async def list_requests(session: AsyncSession, *, page: int, page_size: int) -> EducatorRequestPage:
    statement = _select_requests()
    total = await session.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    rows = await session.execute(statement.offset((page - 1) * page_size).limit(page_size))
    return EducatorRequestPage(
        items=[_view(user, requested_at) for user, requested_at in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


async def _read_one(user_id: str, session: AsyncSession) -> EducatorRequest:
    row = (await session.execute(_select_requests().where(UserModel.id == user_id))).first()
    if row is None:
        raise NotFoundException("Educator request not found")
    user, requested_at = row
    await session.refresh(user)
    return _view(user, requested_at)


async def approve(*, user_id: str, admin_id: str, session: AsyncSession) -> EducatorRequest:
    """Move the requester into the educator group; approving again is a no-op."""
    await _read_one(user_id, session)
    await groups.move_user(user_id=user_id, group_id=EDUCATOR_GROUP, admin_id=admin_id, session=session)
    logger.info(f"Admin {admin_id} approved educator access for {user_id}")
    return await _read_one(user_id, session)


async def remove(*, user_id: str, admin_id: str, session: AsyncSession) -> None:
    """Deny a pending request, or revoke access by moving the user to Student.

    Existing classes stay, unmanaged.
    """
    request = await session.get(EducatorRequestModel, user_id)
    if request is not None:
        await session.delete(request)
        await session.commit()
        logger.info(f"Admin {admin_id} denied educator access for {user_id}")
    elif await groups.read_group_id(user_id, session) == EDUCATOR_GROUP:
        await groups.move_user(user_id=user_id, group_id=STUDENT_GROUP, admin_id=admin_id, session=session)
        logger.info(f"Admin {admin_id} revoked educator access for {user_id}")
    else:
        raise NotFoundException("Educator request not found")
