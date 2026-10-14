"""Composable source-metadata queries; workspace memberships belong to callers."""

from typing import Literal

from sqlalchemy import Select, select

from asterism.core.exceptions import BadDataException

from .models import UserFileModel

FileSort = Literal["name", "kind", "date", "size"]


def select_owned_files(
    *,
    user_id: str,
    query: str | None = None,
    sort_by: FileSort = "name",
) -> Select[tuple[UserFileModel]]:
    orders = {
        "name": UserFileModel.filename.asc(),
        "kind": UserFileModel.kind.asc(),
        "date": UserFileModel.created_at.asc(),
        "size": UserFileModel.size.desc(),
    }
    if sort_by not in orders:
        raise BadDataException("Invalid file sort")
    statement = select(UserFileModel).where(UserFileModel.user_id == user_id)
    if query:
        statement = statement.where(UserFileModel.filename.icontains(query, autoescape=True))
    return statement.order_by(
        orders[sort_by],
        UserFileModel.created_at.desc(),
        UserFileModel.filename,
        UserFileModel.id,
    )
