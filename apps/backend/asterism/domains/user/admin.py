"""The administrator's user list (US-64.3): read-only, searchable and paged.

Names and emails are the display copy synced from Better Auth (ADR-0057).
Roles stay in Better Auth; each user's group (ADR-0058) and educator status
are shown instead.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from asterism.db.queries import paginate_select
from asterism.domains.classes.educators import read_statuses
from asterism.domains.groups.service import read_group_refs

from .queries import select_users
from .schemas import UserSummary, UserSummaryPage


async def list_users(session: AsyncSession, *, search: str | None, page: int, page_size: int) -> UserSummaryPage:
    result = await paginate_select(
        statement=select_users(search=search), session=session, page=page, page_size=page_size
    )
    ids = [row.id for row in result.records]
    statuses = await read_statuses(ids, session)
    groups = await read_group_refs(ids, session)
    return UserSummaryPage(
        items=[
            UserSummary(
                id=row.id,
                name=row.name,
                email=row.email,
                educator=statuses.get(row.id),
                group=groups[row.id],
                created_at=row.created_at,
            )
            for row in result.records
        ],
        total=result.total,
        page=page,
        page_size=page_size,
    )
