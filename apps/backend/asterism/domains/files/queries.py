"""Composable source-metadata queries; workspace memberships belong to callers.

This module owns *owner scope* and *ordering* only. It deliberately knows
nothing about projects or chats so that other domains can compose their own
membership filters on top of the returned statement without the files domain
importing them (enforced by ``tests/test_file_queries.py``).
"""

from typing import Literal

from sqlalchemy import Select, select

from asterism.core.exceptions import BadDataException

from .models import UserFileModel

FileSort = Literal["name", "kind", "date", "size"]
"""Supported sort keys for a file listing."""


def select_owned_files(
    *,
    user_id: str,
    query: str | None = None,
    sort_by: FileSort = "name",
) -> Select[tuple[UserFileModel]]:
    """Build an owner-scoped, deterministically ordered select over the caller's files.

    Callers may add further filters (for example a project-membership
    subquery) before the statement is executed; the owner filter is applied
    here *and* re-applied at the execution boundary in
    :func:`asterism.domains.files.listing.list_file_page`.

    Args:
        user_id: Owner whose files are selected. No other user's rows are
            reachable through the returned statement.
        query: Optional case-insensitive substring filter on the display
            ``filename``. Wildcard characters in the query are escaped.
        sort_by: Primary ordering key. ``"name"`` and ``"kind"`` sort
            ascending, ``"date"`` ascending by creation time, and ``"size"``
            descending (largest first).

    Returns:
        A ``SELECT`` over :class:`UserFileModel` with owner scope, optional
        name filter, and a total ordering (the chosen key, then newest first,
        then filename, then id) so pagination is stable.

    Raises:
        BadDataException: If ``sort_by`` is not a supported sort key.
    """
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
