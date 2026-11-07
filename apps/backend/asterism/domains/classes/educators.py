"""Educator access: a user asks, an administrator decides."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import ForbiddenException, NotFoundException
from asterism.core.schemas import AuthedUser
from asterism.db.queries import paginate_select

from .models import EducatorModel, EducatorStatus
from .schemas import EducatorAccess, EducatorRequest, EducatorRequestPage

logger = get_logger("Educators")


async def read_access(user_id: str, session: AsyncSession) -> EducatorAccess:
    row = await session.get(EducatorModel, user_id, populate_existing=True)
    return EducatorAccess(status=row.status.value if row else "none")


async def require_educator(user_id: str, session: AsyncSession) -> None:
    """Checked live on every request, so a revoked grant stops working at once."""
    if (await read_access(user_id, session)).status != "approved":
        raise ForbiddenException("Educator access is required")


async def request_access(user: AuthedUser, session: AsyncSession) -> EducatorAccess:
    """Idempotent: asking again never changes a decision already made."""
    if await session.get(EducatorModel, user.id) is None:
        session.add(
            EducatorModel(
                user_id=user.id, status=EducatorStatus.PENDING, display_name=user.name or "", email=user.email or ""
            )
        )
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
    return await read_access(user.id, session)


async def list_requests(session: AsyncSession, *, page: int, page_size: int) -> EducatorRequestPage:
    result = await paginate_select(
        statement=select(EducatorModel).order_by(
            EducatorModel.status.desc(), EducatorModel.created_at, EducatorModel.user_id
        ),
        session=session,
        page=page,
        page_size=page_size,
    )
    return EducatorRequestPage(
        items=[EducatorRequest.model_validate(row) for row in result.records],
        total=result.total,
        page=page,
        page_size=page_size,
    )


async def _require_row(user_id: str, session: AsyncSession) -> EducatorModel:
    row = await session.get(EducatorModel, user_id)
    if row is None:
        raise NotFoundException("Educator request not found")
    return row


async def approve(*, user_id: str, admin_id: str, session: AsyncSession) -> EducatorRequest:
    row = await _require_row(user_id, session)
    row.status = EducatorStatus.APPROVED
    row.decided_by = admin_id
    await session.commit()
    logger.info(f"Admin {admin_id} approved educator access for {user_id}")
    return EducatorRequest.model_validate(row)


async def remove(*, user_id: str, admin_id: str, session: AsyncSession) -> None:
    """Deny a request or revoke a grant. Existing classes stay, unmanaged."""
    await session.delete(await _require_row(user_id, session))
    await session.commit()
    logger.info(f"Admin {admin_id} removed educator access for {user_id}")
