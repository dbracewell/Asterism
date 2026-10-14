"""Small query mechanics shared across domains; no domain models or policy."""

from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException


@dataclass(frozen=True)
class QueryPage[T]:
    records: list[T]
    total: int
    page: int
    page_size: int


async def paginate_select[T](
    *,
    statement: Select[tuple[T]],
    session: AsyncSession,
    page: int,
    page_size: int,
) -> QueryPage[T]:
    """Count and paginate a filtered, deterministically ordered entity select.

    Callers supply ownership, filters, and ordering before pagination. This helper
    neither commits nor adds authorization policy or domain response enrichment.
    """
    if page < 1 or not 1 <= page_size <= 100:
        raise BadDataException("Invalid pagination")
    total = await session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    records = list(await session.scalars(statement.offset((page - 1) * page_size).limit(page_size)))
    return QueryPage(records=records, total=total or 0, page=page, page_size=page_size)
