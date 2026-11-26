"""HTTP endpoints for user lifecycle management (``/users``).

This router handles the admin user list, provisioning a new user, deleting
or suspending one, deletion requests (US-86.2), and the signed-in user's
About you text (ADR-0066). Creation is the only
endpoint that can be reached without a JWT — it
additionally accepts the shared ``SYSTEM_KEY`` secret so external tooling
(e.g. the frontend's BetterAuth flow) can provision users out of band.

Deletion is permanent: the service writes a tombstone alongside the row
deletion, so a deleted id can never be re-created and a deleted user's
still-valid JWT is rejected on their next request.
"""

import hmac

from fastapi import APIRouter, Query

import asterism.domains.user.service as user_service
from asterism.core import config
from asterism.core.exceptions import ForbiddenException, UnauthorizedException
from asterism.core.schemas import ErrorDetail
from asterism.db.dependencies import DBSessionDep

from . import about, admin, lifecycle
from .about_schemas import AboutYou, AboutYouUpdate
from .dependencies import ADMIN_REQUIRED_MESSAGE, AdminUserDep, AuthedUserDep, OptionalAuthedUser
from .schemas import CreateUserRequest, DeletionRequest, UserSummaryPage

user_router = APIRouter(
    prefix="/users",
    tags=["settings"],
    responses={404: {"description": "Not found", "model": ErrorDetail}},
)


@user_router.get(
    "/",
    response_model=UserSummaryPage,
    operation_id="userGetMany",
    summary="List accounts (admin only)",
)
async def list_users(
    user: AdminUserDep,
    session: DBSessionDep,
    search: str | None = Query(default=None, max_length=320, description="Matches name, email or id"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
) -> UserSummaryPage:
    """List accounts with their name, email, group, educator status, suspension and deletion request."""
    return await admin.list_users(session, search=search, page=page, page_size=page_size)


@user_router.post(
    "/",
    response_model=bool,
    operation_id="userCreateUser",
    summary="Create a new user with a given user ID",
    responses={401: {"model": ErrorDetail}, 403: {"model": ErrorDetail}},
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
    re-provisioned idempotently). A supplied name and email are stored, or
    synced onto an existing row.

    Args:
        payload: The requested user id and optional system key.
        user: The authenticated caller, or None for unauthenticated/system-key calls.
        session: The database session for performing database operations.

    Returns:
        True if the user was created, False if they already existed.

    Raises:
        UnauthorizedException: If neither credential is valid and no one is signed in.
        ForbiddenException: If a signed-in non-admin presents no valid system key.
        ConflictException: If the id belongs to a deleted (tombstoned) user.
    """
    # Constant-time comparison on bytes: avoids timing side channels and the
    # ASCII-only restriction of compare_digest on str.
    has_valid_system_key = bool(
        payload.system_key
        and config.system_key
        and hmac.compare_digest(payload.system_key.get_secret_value().encode(), config.system_key.encode())
    )
    if not has_valid_system_key:
        if user is None:
            raise UnauthorizedException()
        if user.role != "admin":
            # A valid token is not the problem for a signed-in non-admin (US-90.1).
            raise ForbiddenException(ADMIN_REQUIRED_MESSAGE)
        # An admin token alone counts only while that account is still live:
        # a deleted or suspended admin's unexpired token is refused (US-112.2).
        await user_service.ensure_user(user_id=user.id, session=session)
        await lifecycle.assert_active(user.id, session)
    return (
        await user_service.create_user(
            user_id=payload.user_id,
            session=session,
            identity=user_service.UserIdentity.of(name=payload.name, email=payload.email),
        )
        is user_service.UserCreateOutcome.CREATED
    )


@user_router.get(
    "/me/about",
    response_model=AboutYou,
    operation_id="userAboutGet",
    summary="Read your About you text",
)
async def get_about(user: AuthedUserDep, session: DBSessionDep) -> AboutYou:
    """What you wrote about yourself, and its revision. Empty until you write it."""
    return await about.get_about(user_id=user.id, session=session)


@user_router.put(
    "/me/about",
    response_model=AboutYou,
    operation_id="userAboutUpdate",
    summary="Replace your About you text",
    responses={409: {"description": "The text changed since you read it", "model": ErrorDetail}},
)
async def update_about(payload: AboutYouUpdate, user: AuthedUserDep, session: DBSessionDep) -> AboutYou:
    """Replace your About you text if ``expected_revision`` is still current.

    About you is information about you that Asterism uses when it answers.
    It grants nothing: no tools, files, delegation, role or memory access.
    """
    return await about.update_about(user_id=user.id, payload=payload, session=session)


@user_router.get(
    "/me/deletion-request",
    response_model=DeletionRequest,
    operation_id="userDeletionRequestGet",
    summary="Your account deletion request",
)
async def get_deletion_request(user: AuthedUserDep, session: DBSessionDep) -> DeletionRequest:
    return DeletionRequest(requested_at=await lifecycle.deletion_requested_at(user.id, session))


@user_router.put(
    "/me/deletion-request",
    response_model=DeletionRequest,
    operation_id="userDeletionRequestCreate",
    summary="Ask an administrator to delete your account",
    responses={403: {"model": ErrorDetail}},
)
async def create_deletion_request(user: AuthedUserDep, session: DBSessionDep) -> DeletionRequest:
    """Ask for deletion. It grants nothing and changes nothing else; an administrator decides."""
    requested_at = await lifecycle.request_deletion(user_id=user.id, is_admin=user.role == "admin", session=session)
    return DeletionRequest(requested_at=requested_at)


@user_router.delete(
    "/me/deletion-request",
    response_model=DeletionRequest,
    operation_id="userDeletionRequestWithdraw",
    summary="Withdraw your account deletion request",
)
async def withdraw_deletion_request(user: AuthedUserDep, session: DBSessionDep) -> DeletionRequest:
    await lifecycle.withdraw_deletion(user_id=user.id, session=session)
    return DeletionRequest(requested_at=None)


@user_router.delete(
    "/{user_id}/deletion-request",
    response_model=bool,
    operation_id="userDeletionRequestDismiss",
    summary="Dismiss a user's deletion request (admin only)",
)
async def dismiss_deletion_request(user_id: str, user: AdminUserDep, session: DBSessionDep) -> bool:
    """Close the request without deleting anything."""
    await lifecycle.dismiss_deletion(actor_id=user.id, user_id=user_id, session=session)
    return True


@user_router.put(
    "/{user_id}/suspension",
    response_model=bool,
    operation_id="userSuspend",
    summary="Suspend an account (admin only)",
    responses={403: {"model": ErrorDetail}, 409: {"model": ErrorDetail}},
)
async def suspend_user(user_id: str, user: AdminUserDep, session: DBSessionDep) -> bool:
    """Refuse the account's tokens and stop its running work; data is kept. Idempotent.

    The frontend also bans the account in Better Auth, which blocks sign-in and
    revokes its sessions. Admins can't suspend themselves or the last administrator.
    """
    await lifecycle.suspend_user(actor_id=user.id, user_id=user_id, session=session)
    return True


@user_router.delete(
    "/{user_id}/suspension",
    response_model=bool,
    operation_id="userReactivate",
    summary="Reactivate a suspended account (admin only)",
)
async def reactivate_user(user_id: str, user: AdminUserDep, session: DBSessionDep) -> bool:
    await lifecycle.reactivate_user(actor_id=user.id, user_id=user_id, session=session)
    return True


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

    Admin-only via :data:`AdminUserDep`. An admin may not delete their own
    account or the last administrator. The frontend deletes the Better Auth
    account first; retrying after a partial failure is safe.

    Args:
        user_id: The id of the user to delete (may differ from the caller).
        user: The authenticated admin caller, guaranteed to have a DB row.
        session: The database session for performing database operations.

    Returns:
        True when the user was deleted.

    Raises:
        ForbiddenException: If the caller tries to delete their own account.
        ConflictException: If the user is the last administrator.
        NotFoundException: If no such user exists.
    """
    await lifecycle.check_delete(actor_id=user.id, user_id=user_id, session=session)
    await user_service.delete_user(
        user_id=user_id,
        session=session,
    )
    return True
