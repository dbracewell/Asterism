import ast
from pathlib import Path

import pytest
from asterism.core.exceptions import BadDataException
from asterism.db.queries import paginate_select
from asterism.domains.files.listing import list_file_page
from asterism.domains.files.models import UserFileModel
from asterism.domains.files.queries import select_owned_files
from asterism.domains.files.service import upload_files
from sqlalchemy import select, update
from test_user_files import _upload
from test_user_files import file_session as _file_session

file_session = _file_session


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sort_by,expected",
    [
        ("name", ["a%_.txt", "z.txt"]),
        ("kind", ["a%_.txt", "z.txt"]),
        ("date", ["a%_.txt", "z.txt"]),
        ("size", ["z.txt", "a%_.txt"]),
    ],
)
async def test_composed_file_filters_apply_before_count_and_stable_pagination(file_session, sort_by, expected):
    owned = await upload_files(
        user_id="user-a",
        session=file_session,
        uploads=[
            _upload("z.txt", b"larger"),
            _upload("a%_.txt", b"a"),
            _upload("excluded.txt", b"excluded"),
        ],
    )
    foreign = await upload_files(user_id="user-b", session=file_session, uploads=[_upload("foreign.txt", b"foreign")])
    await file_session.execute(update(UserFileModel).values(created_at=100))
    await file_session.commit()
    # The caller can compose a membership subquery without extending the file
    # service API. Foreign candidates still cannot escape owner scope.
    candidates = select(UserFileModel.id).where(
        UserFileModel.id.in_(
            [owned.files[0].id, owned.files[1].id, foreign.files[0].id],
        ),
    )
    statement = select_owned_files(user_id="user-a", sort_by=sort_by).where(UserFileModel.id.in_(candidates))
    pages = [
        await list_file_page(user_id="user-a", statement=statement, session=file_session, page=p, page_size=1)
        for p in (1, 2, 3)
    ]
    assert [p.total for p in pages] == [2, 2, 2]
    assert [p.files[0].filename for p in pages[:2]] == expected
    assert pages[2].files == []
    searched = await list_file_page(
        user_id="user-a",
        session=file_session,
        statement=select_owned_files(user_id="user-a", query="%_"),
    )
    assert [file.filename for file in searched.files] == ["a%_.txt"]


@pytest.mark.asyncio
async def test_file_page_execution_enforces_owner_even_for_unscoped_select(file_session):
    await upload_files(user_id="user-a", session=file_session, uploads=[_upload("owned.txt", b"a")])
    await upload_files(user_id="user-b", session=file_session, uploads=[_upload("foreign.txt", b"b")])
    page = await list_file_page(
        user_id="user-a",
        session=file_session,
        statement=select(UserFileModel).order_by(UserFileModel.filename),
    )
    assert page.total == 1
    assert [file.filename for file in page.files] == ["owned.txt"]


@pytest.mark.asyncio
@pytest.mark.parametrize("page,page_size", [(0, 50), (1, 0), (1, 101)])
async def test_shared_pagination_rejects_invalid_bounds(file_session, page, page_size):
    with pytest.raises(BadDataException, match="Invalid pagination"):
        await paginate_select(
            statement=select_owned_files(user_id="user-a"),
            session=file_session,
            page=page,
            page_size=page_size,
        )


def test_query_layer_dependency_boundaries():
    root = Path(__file__).resolve().parents[1] / "asterism"
    for path, forbidden in [
        (root / "db/queries.py", ("asterism.domains",)),
        (root / "domains/files/queries.py", ("asterism.domains.projects",)),
    ]:
        tree = ast.parse(path.read_text())
        imports = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
        assert not any(name.startswith(forbidden) for name in imports)
