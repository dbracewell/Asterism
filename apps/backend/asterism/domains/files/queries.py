"""Composable source-metadata queries; workspace memberships belong to callers.

This module owns *owner scope* and *ordering* only. It deliberately knows
nothing about projects or chats so that other domains can compose their own
membership filters on top of the returned statement without the files domain
importing them (enforced by ``tests/test_file_queries.py``).
"""

import uuid
from collections.abc import Iterable
from typing import Literal

from sqlalchemy import Select, select

from asterism.core.exceptions import BadDataException

from .models import FileOrigin, UserFileModel

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


def select_produced_files(
    *,
    user_id: str,
    chat_id: uuid.UUID,
    run_ids: Iterable[uuid.UUID],
) -> Select[tuple[UserFileModel]]:
    """Select the caller's files that tools produced in the given runs of one chat.

    Provenance only narrows; callers still add their membership filter, which is
    what grants scope.
    """
    return select_owned_files(user_id=user_id).where(
        UserFileModel.origin == FileOrigin.AGENT,
        UserFileModel.produced_chat_id == chat_id,
        UserFileModel.produced_execution_id.in_(list(run_ids)),
    )


def _owned(user_id: str) -> Select[tuple[UserFileModel]]:
    """Unordered owner-scoped base for point lookups; listings use ``select_owned_files``."""
    return select(UserFileModel).where(UserFileModel.user_id == user_id)


def select_file_by_name(*, user_id: str, filename: str) -> Select[tuple[UserFileModel]]:
    """Select the caller's file with this display name (names are unique per owner)."""
    return _owned(user_id).where(UserFileModel.filename == filename)


def select_files_by_names(*, user_id: str, filenames: Iterable[str]) -> Select[tuple[UserFileModel]]:
    """Select the caller's files with any of these display names; unknown names match nothing."""
    return _owned(user_id).where(UserFileModel.filename.in_(list(filenames)))


def select_files_by_ids(*, user_id: str, file_ids: Iterable[uuid.UUID]) -> Select[tuple[UserFileModel]]:
    """Select the caller's files among these ids; foreign ids match nothing."""
    return _owned(user_id).where(UserFileModel.id.in_(list(file_ids)))


def select_owned_file_ids(*, user_id: str, file_ids: Iterable[uuid.UUID]) -> Select[tuple[uuid.UUID]]:
    """Select which of these ids the caller owns, without loading the rows."""
    return select_files_by_ids(user_id=user_id, file_ids=file_ids).with_only_columns(UserFileModel.id)


def select_file_id_by_name(*, user_id: str, filename: str) -> Select[tuple[uuid.UUID]]:
    """Select the id of the caller's file with this display name, if any."""
    return select_file_by_name(user_id=user_id, filename=filename).with_only_columns(UserFileModel.id)


def select_file_by_content(*, user_id: str, original_name: str, sha256: str) -> Select[tuple[UserFileModel]]:
    """Select the caller's earlier upload of the same name and bytes, for upload reuse."""
    return _owned(user_id).where(UserFileModel.original_name == original_name, UserFileModel.sha256 == sha256)
