"""Account lifecycle beyond creation (US-86.2): suspension, guards, deletion requests.

Better Auth owns sign-in: the frontend's admin actions ban the account there
(blocking sign-in and revoking sessions) and call these endpoints, which make
the backend refuse the account's still-valid tokens. ``users.suspended_at``
is the backend's record; reactivating clears it and keeps all data.

Guards: an admin can't suspend or delete their own account, and the last
active administrator can't be suspended or deleted. The admin group mirrors
the token role (ADR-0058), so it is the backend's view of who is an admin.

A deletion request is a user's ask; it grants nothing and changes no other
data. Only admins delete accounts (EPIC-86 decision 2).

The suspension check runs on every authenticated request and WebSocket
connect. A per-process TTL cache keeps it off the database; this process is
the only writer (ADR-0019), and suspend/reactivate update the cache directly.
"""

from cachetools import TTLCache
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException, ForbiddenException, NotFoundException, UnauthorizedException
from asterism.db.mixins import get_unix_timestamp
from asterism.domains.groups.models import ADMIN_GROUP

from .models import AccountDeletionRequestModel, UserModel
from .queries import select_active_admin_count
from .service import LAST_ADMIN_MESSAGE, find_user_work, stop_user_work

logger = get_logger("USER-LIFECYCLE")

SUSPENDED_MESSAGE = "This account is suspended. Ask your administrator."

# user_id -> suspended? Only an optimization; misses read the row.
_suspended_cache = TTLCache[str, bool](maxsize=10000, ttl=300)


def clear_suspension_cache() -> None:
    """Forget cached suspension states (tests and process teardown)."""
    _suspended_cache.clear()


async def is_suspended(user_id: str, session: AsyncSession) -> bool:
    cached = _suspended_cache.get(user_id)
    if cached is not None:
        return cached
    suspended_at = await session.scalar(select(UserModel.suspended_at).where(UserModel.id == user_id))
    suspended = suspended_at is not None
    _suspended_cache[user_id] = suspended
    return suspended


async def assert_active(user_id: str, session: AsyncSession) -> None:
    """Refuse a suspended account's request, whatever its token says.

    Raises:
        UnauthorizedException: If the account is suspended.
    """
    if await is_suspended(user_id, session):
        raise UnauthorizedException(SUSPENDED_MESSAGE)


async def _target(user_id: str, session: AsyncSession) -> UserModel:
    user = await session.get(UserModel, user_id)
    if user is None:
        raise NotFoundException("User not found")
    return user


async def check_admin_action(actor_id: str, target: UserModel, action: str, session: AsyncSession) -> None:
    """Refuse an admin suspending or deleting themselves or the last active administrator.

    Args:
        actor_id: The admin doing it.
        target: The account it is done to.
        action: "suspend" or "delete", for the message.

    Raises:
        ForbiddenException: For the admin's own account.
        ConflictException: For the last active administrator.
    """
    if target.id == actor_id:
        raise ForbiddenException(f"You can't {action} your own account")
    if target.group_id != ADMIN_GROUP:
        return
    if not await session.scalar(select_active_admin_count(excluding=target.id)):
        raise ConflictException(LAST_ADMIN_MESSAGE.format(action=action))


async def suspend_user(*, actor_id: str, user_id: str, session: AsyncSession) -> None:
    """Suspend an account: refuse its tokens and stop its running chats and file jobs.

    Idempotent: suspending a suspended account keeps the original time and
    stops any work again. Data is kept.
    """
    target = await _target(user_id, session)
    await check_admin_action(actor_id, target, "suspend", session)
    await session.execute(
        update(UserModel)
        .where(UserModel.id == user_id, UserModel.suspended_at.is_(None))
        .values(suspended_at=get_unix_timestamp())
    )
    # Re-check after the write, in the same transaction: two admins
    # suspending each other at once must not leave no active administrator.
    if target.group_id == ADMIN_GROUP and not await session.scalar(select_active_admin_count()):
        await session.rollback()
        raise ConflictException(LAST_ADMIN_MESSAGE.format(action="suspend"))
    work = await find_user_work(user_id, session)
    await session.commit()
    _suspended_cache[user_id] = True
    logger.info("Suspended user %s (by %s)", user_id, actor_id)
    await stop_user_work(user_id, work)


async def reactivate_user(*, actor_id: str, user_id: str, session: AsyncSession) -> None:
    """Lift a suspension; idempotent."""
    await _target(user_id, session)
    await session.execute(update(UserModel).where(UserModel.id == user_id).values(suspended_at=None))
    await session.commit()
    _suspended_cache[user_id] = False
    logger.info("Reactivated user %s (by %s)", user_id, actor_id)


async def deletion_requested_at(user_id: str, session: AsyncSession) -> int | None:
    return await session.scalar(
        select(AccountDeletionRequestModel.requested_at).where(AccountDeletionRequestModel.user_id == user_id)
    )


async def read_deletion_requests(user_ids: list[str], session: AsyncSession) -> dict[str, int]:
    """When each of these users asked for deletion, for those with an open request."""
    if not user_ids:
        return {}
    rows = await session.execute(
        select(AccountDeletionRequestModel.user_id, AccountDeletionRequestModel.requested_at).where(
            AccountDeletionRequestModel.user_id.in_(user_ids)
        )
    )
    return {row.user_id: row.requested_at for row in rows}


async def request_deletion(*, user_id: str, is_admin: bool, session: AsyncSession) -> int:
    """Open (or keep) the user's deletion request and return when it was made.

    Raises:
        ForbiddenException: For administrators, who don't need to ask.
    """
    if is_admin:
        raise ForbiddenException("Administrators can't request deletion; another administrator deletes accounts")
    await session.execute(
        sqlite_insert(AccountDeletionRequestModel)
        .values(user_id=user_id, requested_at=get_unix_timestamp())
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    await session.commit()
    requested_at = await deletion_requested_at(user_id, session)
    assert requested_at is not None
    logger.info("User %s requested account deletion", user_id)
    return requested_at


async def withdraw_deletion(*, user_id: str, session: AsyncSession) -> None:
    """Withdraw the user's own request (or an admin dismisses it); idempotent."""
    await session.execute(delete(AccountDeletionRequestModel).where(AccountDeletionRequestModel.user_id == user_id))
    await session.commit()


async def dismiss_deletion(*, actor_id: str, user_id: str, session: AsyncSession) -> None:
    """An admin dismisses a user's request without deleting anything."""
    await _target(user_id, session)
    await withdraw_deletion(user_id=user_id, session=session)
    logger.info("Dismissed the deletion request of user %s (by %s)", user_id, actor_id)


async def check_delete(*, actor_id: str, user_id: str, session: AsyncSession) -> None:
    """Apply the self and last-admin guards before an admin deletes ``user_id``."""
    await check_admin_action(actor_id, await _target(user_id, session), "delete", session)
