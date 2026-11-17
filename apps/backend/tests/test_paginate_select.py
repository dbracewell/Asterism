from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from asterism.db.queries import paginate_select
from sqlalchemy import Column, Integer, MetaData, String, Table, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_metadata = MetaData()
_items = Table(
    "items",
    _metadata,
    Column("id", Integer, primary_key=True),
    Column("category", String, nullable=False),
)


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(_metadata.create_all)
        await connection.execute(
            insert(_items),
            [{"category": category} for category in ["a", "a", "a", "b", "b", "c"]],
        )
    async with async_sessionmaker(engine)() as db_session:
        yield db_session
    await engine.dispose()


@pytest.mark.asyncio
async def test_plain_single_table_select_counts_filtered_rows(session: AsyncSession) -> None:
    statement = select(_items.c.id).where(_items.c.category != "c").order_by(_items.c.id)

    page = await paginate_select(statement=statement, session=session, page=1, page_size=2)

    assert page.total == 5
    assert page.records == [1, 2]


@pytest.mark.asyncio
async def test_distinct_single_table_select_counts_distinct_rows(session: AsyncSession) -> None:
    statement = select(_items.c.category).distinct().order_by(_items.c.category)

    page = await paginate_select(statement=statement, session=session, page=1, page_size=2)

    assert page.total == 3
    assert page.records == ["a", "b"]


@pytest.mark.asyncio
async def test_grouped_single_table_select_counts_groups(session: AsyncSession) -> None:
    statement = select(_items.c.category).group_by(_items.c.category).order_by(_items.c.category)

    page = await paginate_select(statement=statement, session=session, page=2, page_size=2)

    assert page.total == 3
    assert page.records == ["c"]


@pytest.mark.asyncio
async def test_having_single_table_select_counts_matching_groups(session: AsyncSession) -> None:
    statement = (
        select(_items.c.category)
        .group_by(_items.c.category)
        .having(func.count(_items.c.id) > 1)
        .order_by(_items.c.category)
    )

    page = await paginate_select(statement=statement, session=session, page=1, page_size=10)

    assert page.total == 2
    assert page.records == ["a", "b"]
