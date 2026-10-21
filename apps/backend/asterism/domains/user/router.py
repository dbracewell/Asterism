"""HTTP endpoints for user lifecycle management (``/users``).

Three operations exist: listing users, provisioning a new one, and deleting
one. Creation is the only endpoint that can be reached without a JWT — it
additionally accepts the shared ``SYSTEM_KEY`` secret so external tooling
(e.g. the frontend's BetterAuth flow) can provision users out of band.

Deletion is permanent: the service writes a tombstone alongside the row
deletion, so a deleted id can never be re-created and a deleted user's
still-valid JWT is rejected on their next request.
"""

import hmac

from fastapi import APIRouter

import asterism.domains.user.service as user_service
from asterism.core import config
from asterism.core.exceptions import ForbiddenException, UnauthorizedException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep

from .dependencies import AdminUserDep, OptionalAuthedUser
from .schemas import CreateUserRequest

user_router = APIRouter(
    prefix="/users",
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@user_router.get(
    "/",
    response_model=list[str],
    operation_id="userListUsers",
    summary="List all user ids (admin only)",
)
async def list_users(
    user: AdminUserDep,
    session: DBSessionDep,
) -> list[str]:
    """Return the sorted ids of all existing users.

    The users table stores ids only (identity details live in BetterAuth), so
    this is the full extent of what an admin can enumerate.

    Args:
        user: The authenticated admin caller.
        session: The database session for performing database operations.

    Returns:
        The sorted list of user ids.
    """
    return await user_service.list_users(session=session)


@user_router.post(
    "/",
    response_model=bool,
    operation_id="userCreateUser",
    summary="Create a new user with a given user ID",
)
async def create_user(
    payload: CreateUserRequest,
    user: OptionalAuthedUser,
    session: DBSessionDep,
) -> bool:
    """Provision a user row plus its main-agent configuration.

    Authorization is satisfied by either of two independent credentials:
    an authenticated admin JWT, or a valid ``system_key`` matching the
    server's configured secret. A request may present both; only one is
    required. The body returns ``true`` when the row was newly created and
    ``false`` when the user already existed (their settings are still
    re-provisioned idempotently).

    Args:
        payload: The requested user id and optional system key.
        user: The authenticated caller, or None for unauthenticated/system-key calls.
        session: The database session for performing database operations.

    Returns:
        True if the user was created, False if they already existed.

    Raises:
        UnauthorizedException: If neither credential is valid.
        ConflictException: If the id belongs to a deleted (tombstoned) user.
    """
    # Constant-time comparison on bytes: avoids timing side channels and the
    # ASCII-only restriction of compare_digest on str.
    has_valid_system_key = bool(
        payload.system_key
        and config.system_key
        and hmac.compare_digest(payload.system_key.encode(), config.system_key.encode())
    )
    can_add = bool((user and user.role == "admin") or has_valid_system_key)
    if not can_add:
        raise UnauthorizedException()
    return (
        await user_service.create_user(
            user_id=payload.user_id,
            session=session,
        )
        is user_service.UserCreateOutcome.CREATED
    )


@user_router.delete(
    "/{user_id}",
    operation_id="userDelete",
    summary="Delete a user",
)
async def delete_user(
    user_id: str,
    user: AdminUserDep,
    session: DBSessionDep,
) -> bool:
    """Permanently delete a user (row, tombstone, files, and vectors).

    Admin-only via :data:`AdminUserDep`, and an admin may not delete their
    own account — doing so would cascade-delete their data while their live
    JWT keeps them able to re-enter the system.

    Args:
        user_id: The id of the user to delete (may differ from the caller).
        user: The authenticated admin caller, guaranteed to have a DB row.
        session: The database session for performing database operations.

    Returns:
        True when the user was deleted.

    Raises:
        ForbiddenException: If the caller tries to delete their own account.
        NotFoundException: If no such user exists.
    """
    if user_id == user.id:
        raise ForbiddenException("Cannot delete your own account")
    await user_service.delete_user(
        user_id=user_id,
        session=session,
    )
    return True
