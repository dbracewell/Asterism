"""Small query mechanics shared across domains; no domain models or policy."""

from dataclasses import dataclass
from typing import cast

from sqlalchemy import Select, Table, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.core.exceptions import BadDataException


@dataclass(frozen=True)
class QueryPage[T]:
    """One page of a paged query result.

    Attributes:
        records: The entities on this page (possibly empty).
        total: Total number of matching rows across all pages.
        page: 1-based page number that was requested.
        page_size: Page size that was requested.
    """

    records: list[T]
    total: int
    page: int
    page_size: int


def _simple_count(statement: Select) -> Select | None:
    """Build a cheap ``COUNT(pk)`` for single-table selects, else ``None``.

    Returns a count statement only when the select reads from exactly one
    table with a single-column primary key and no joins; the original
    where-clause is reused verbatim so the count sees exactly the rows the
    page query would. Anything more complex (joins, subqueries, composite or
    missing PKs) returns ``None`` and the caller falls back to counting the
    full statement subquery.
    """
    froms = statement.get_final_froms()
    if len(froms) != 1:
        return None
    table = froms[0]
    if not isinstance(table, Table):
        return None
    primary_keys = list(table.primary_key.columns)
    if len(primary_keys) != 1:
        return None
    count_statement: Select = select(func.count(primary_keys[0])).select_from(table)
    if statement.whereclause is not None:
        count_statement = count_statement.where(statement.whereclause)
    return count_statement


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

    For single-table selects the count is a plain ``COUNT(pk)`` with the same
    where-clause (no subquery materialization of wide columns). For joins and
    other complex statements it falls back to counting the statement as a
    subquery; note that for joined statements both the count and the page then
    count *joined rows*, not distinct entities.

    Args:
        statement: A ``select`` of single-entity tuples with all domain filters
            applied (ordering optional; stripped for the count).
        session: Active async session; no commit happens here.
        page: 1-based page number.
        page_size: Rows per page, clamped to 1..100.

    Raises:
        BadDataException: if ``page`` < 1 or ``page_size`` is outside 1..100.
    """
    if page < 1 or not 1 <= page_size <= 100:
        raise BadDataException("Invalid pagination")
    count_statement = _simple_count(statement)
    if count_statement is None:
        count_statement = select(func.count()).select_from(statement.order_by(None).subquery())
    # COUNT always yields exactly one integer row; scalar() is typed Optional.
    total: int = cast(int, await session.scalar(count_statement))
    records = list(await session.scalars(statement.offset((page - 1) * page_size).limit(page_size)))
    return QueryPage(records=records, total=total, page=page, page_size=page_size)
