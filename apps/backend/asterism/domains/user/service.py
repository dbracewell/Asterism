"""User lifecycle service: creation, existence checks, provisioning, deletion.

Design notes:

- Creation is self-healing. The primary path inserts the user row and
  creates its default persona and main-agent configuration in one transaction; if a concurrent
  caller wins the insert race (IntegrityError), we fall back to re-provisioning
  settings on the existing row instead of failing. ``provision_main_agent``
  is itself idempotent via a unique index, so double provisioning is safe.

- Deletion is permanent and total. The user row deletion and a tombstone
  insert share one transaction, so a deleted id can never be re-created (the
  tombstone blocks both admin/system-key creates and the auto-provisioning in
  :func:`ensure_user`, which otherwise would resurrect a deleted user from
  their still-valid JWT). After the relational delete commits, non-relational
  data (file-store sources, knowledge vectors) is removed best-effort; the
  database remains authoritative, matching the files domain's deletion policy.

- Three module-level TTL caches keep steady-state auth checks off the database:
  ``_user_cache`` memoizes existence results, ``_user_initialized_cache``
  memoizes "settings were provisioned" so :func:`ensure_user` (called on every
  authenticated request) becomes a dict lookup after first contact, and
  ``_deleted_cache`` memoizes tombstone hits so rejected deleted users cost
  one lookup per process per TTL. All are per-process, single-event-loop
  structures and only an optimization, never the source of truth — every
  cached path degrades gracefully to a DB check or a self-healing re-provision.
"""

from enum import StrEnum

from cachetools import TTLCache
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core.exceptions import ConflictException, NotFoundException, UnauthorizedException
from asterism.db.database import get_async_db_session
from asterism.domains.agent.service import provision_main_agent
from asterism.domains.user.models import DeletedUserModel, UserModel

logger = get_logger("USER-SERVICE")


class UserCreateOutcome(StrEnum):
    """The two distinct results of a user creation attempt.

    Attributes:
        CREATED: The user row and main-agent configuration were newly created.
        ALREADY_EXISTS: The user already existed; settings were re-provisioned
            idempotently and nothing new was created.
    """

    CREATED = "created"
    ALREADY_EXISTS = "already_exists"


# Existence memo: user_id -> whether the row exists. Negative results are
# cached too; a stale "absent" is harmless because ensure_user falls through
# to create_user, whose IntegrityError path handles "already exists".
_user_cache = TTLCache[str, bool](maxsize=1000, ttl=3600)
# Provisioning memo: user_id -> main-agent settings were initialized. A miss
# simply re-runs the idempotent provisioning on the next request.
_user_initialized_cache = TTLCache[str, bool](maxsize=1000, ttl=3600)
# Tombstone memo: user_id -> the id is permanently deleted. Only positive hits
# are cached; a stale "deleted" would at worst reject a create that the DB
# also rejects (the tombstone row itself is authoritative).
_deleted_cache = TTLCache[str, bool](maxsize=1000, ttl=3600)


async def _is_user_deleted(
    user_id: str,
    session: AsyncSession | None = None,
) -> bool:
    """Check the tombstone table for a permanently deleted user id."""
    if _deleted_cache.get(user_id):
        return True
    async with get_async_db_session(session) as session:
        tombstone = await session.get(DeletedUserModel, user_id)
        if tombstone is not None:
            _deleted_cache[user_id] = True
        return tombstone is not None


async def create_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> UserCreateOutcome:
    """Create a user, its default persona and main-agent configuration atomically.

    The insert and provisioning share one transaction, so a user can never be
    left without their singleton main-agent configuration. Deleted ids are
    permanently rejected (see :class:`DeletedUserModel`).

    Args:
        user_id: The stable identifier to provision.
        session: An existing session to reuse; when None a new one is opened
            (and owned) by this function.

    Returns:
        UserCreateOutcome.CREATED if the row was newly created, or
        UserCreateOutcome.ALREADY_EXISTS if the user already existed (in which
        case their settings were re-provisioned idempotently).

    Raises:
        ConflictException: If the id belongs to a deleted (tombstoned) user.
        IntegrityError: If the insert failed for a reason other than the row
            already existing (e.g. a constraint violation on another table).
    """
    async with get_async_db_session(session) as session:
        if await _is_user_deleted(user_id, session):
            raise ConflictException("User has been deleted and cannot be re-created")
        try:
            stmt = insert(UserModel).values(id=user_id)
            await session.execute(stmt)
            await provision_main_agent(user_id, session)
            await session.commit()
            _user_cache[user_id] = True
            _user_initialized_cache[user_id] = True
            return UserCreateOutcome.CREATED
        except IntegrityError:
            # Lost an insert race (or the row pre-existed): roll back and
            # decide by looking the row up again.
            await session.rollback()
            if await session.get(UserModel, user_id) is None:
                # Not a duplicate — some other integrity problem; surface it.
                raise
            await initialize_user_settings(user_id, session)
            _user_cache[user_id] = True
            _user_initialized_cache[user_id] = True
            return UserCreateOutcome.ALREADY_EXISTS


async def user_exists(
    user_id: str,
    session: AsyncSession | None = None,
) -> bool:
    """Check whether a user row exists, memoizing the result for up to 1 hour.

    Args:
        user_id: The identifier to check.
        session: An existing session to reuse; when None a new one is opened.

    Returns:
        True if the user row exists (or was previously confirmed in this process).
    """
    exists = _user_cache.get(user_id)
    if exists:
        return exists
    async with get_async_db_session(session) as session:
        user = await session.get(UserModel, user_id)
        _user_cache[user_id] = user is not None
        return user is not None


async def ensure_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> None:
    """Guarantee the user row and its main-agent configuration exist.

    Fast path: a cached "initialized" flag makes this a no-op after first
    contact in this process. Otherwise an existing user gets their settings
    re-provisioned (idempotent), and an unknown user is created wholesale —
    unless the id was deleted, in which case authentication is rejected rather
    than resurrecting the account.

    Args:
        user_id: The identifier to ensure.
        session: An existing session to reuse; when None a new one is opened.
            Note that create_user commits internally, so the reused session
            may be left in a committed state on the creation path.

    Raises:
        UnauthorizedException: If the id belongs to a deleted user.
    """
    if _user_initialized_cache.get(user_id):
        return
    async with get_async_db_session(session) as session:
        user = await user_exists(user_id=user_id, session=session)
        if user:
            await initialize_user_settings(
                user_id=user_id,
                session=session,
            )
            _user_initialized_cache[user_id] = True
            return
        if await _is_user_deleted(user_id, session):
            raise UnauthorizedException("User account has been deleted")
        await create_user(user_id, session)


def clear_user_cache() -> None:
    """Drop all cached existence/provisioning/tombstone entries.

    Intended for tests (and process teardown); production code relies on the
    TTL and the targeted updates in :func:`delete_user` instead.
    """
    _user_cache.clear()
    _user_initialized_cache.clear()
    _deleted_cache.clear()


async def initialize_user_settings(
    user_id: str,
    session: AsyncSession | None = None,
) -> None:
    """Provision the user's singleton main-agent configuration if missing.

    ``provision_main_agent`` reports whether it actually inserted; we only
    commit in that case since an existing configuration means nothing changed.

    Args:
        user_id: The identifier whose settings to initialize.
        session: An existing session to reuse; when None a new one is opened.

    Raises:
        NotFoundException: If the user row itself does not exist (provisioning
            refuses to create an agent for a missing user).
    """
    async with get_async_db_session(session) as session:
        created = await provision_main_agent(user_id, session)
        if created:
            await session.commit()


async def delete_user(
    user_id: str,
    session: AsyncSession | None = None,
) -> None:
    """Delete a user permanently: row (with FK cascades), tombstone, and storage.

    The relational delete and the tombstone insert commit as one transaction,
    so the id can never be re-created afterwards. Only after that commit do we
    best-effort remove non-relational data owned by the user — file-store
    sources (the whole owner shard) and knowledge vectors — logging failures
    instead of aborting, consistent with the files domain's policy that the
    database remains authoritative for what a deleted user may access.

    Args:
        user_id: The identifier to delete.

    Raises:
        NotFoundException: If no such user exists.
    """
    async with get_async_db_session(session) as session:
        if await session.get(UserModel, user_id) is None:
            raise NotFoundException("User not found")
        try:
            await session.execute(delete(UserModel).where(UserModel.id == user_id))
            await session.execute(insert(DeletedUserModel).values(id=user_id))
            await session.commit()
        except IntegrityError:
            # Lost a concurrent delete race: the other caller already wrote
            # the tombstone. Verify and treat the deletion as done.
            await session.rollback()
            if not await _is_user_deleted(user_id, session):
                raise

    _user_cache.pop(user_id, None)
    _user_initialized_cache.pop(user_id, None)
    _deleted_cache[user_id] = True

    # Non-relational cleanup is best-effort: a failure here orphans storage
    # but must not undo the authoritative relational deletion.
    from asterism.domains.files.store import get_file_store
    from asterism.domains.knowledge.vector_store import vector_store

    try:
        get_file_store().delete_user(user_id)
    except Exception:  # noqa: BLE001 - storage cleanup must not block deletion
        logger.exception("Failed to remove file store data for deleted user %s", user_id)
    try:
        await vector_store.delete_user(user_id=user_id)
    except Exception:  # noqa: BLE001 - storage cleanup must not block deletion
        logger.exception("Failed to remove knowledge vectors for deleted user %s", user_id)


async def list_users(
    session: AsyncSession | None = None,
) -> list[str]:
    """List the ids of all existing users, sorted for stable output.

    Args:
        session: An existing session to reuse; when None a new one is opened.

    Returns:
        The sorted list of user ids (empty when no users exist).
    """
    async with get_async_db_session(session) as session:
        result = await session.scalars(select(UserModel.id).order_by(UserModel.id))
        return list(result.all())
