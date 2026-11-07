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

- The users row keeps a display copy of the Better Auth name and email
  (ADR-0057). Provisioning stores them, and :func:`sync_identity` refreshes
  them from verified claims. A fourth TTL cache, ``_identity_cache``, holds
  the last values confirmed in the row so unchanged claims cost a dict lookup
  and never a write. Missing or blank values never overwrite a stored one.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from enum import StrEnum

from cachetools import TTLCache
from sqlalchemy import delete, insert, select, update
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


@dataclass(frozen=True)
class UserIdentity:
    """A display copy of Better Auth's name and email; ``None`` means unknown.

    Build it with :meth:`of`, which trims values and drops blank ones so an
    absent claim can never blank a stored value.
    """

    name: str | None = None
    email: str | None = None

    @classmethod
    def of(cls, *, name: object = None, email: object = None) -> "UserIdentity":
        return cls(name=_clean(name, 255), email=_clean(email, 320))

    def values(self) -> dict[str, str]:
        """The known fields, keyed by column name."""
        return {key: value for key, value in (("name", self.name), ("email", self.email)) if value is not None}


def _clean(value: object, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] or None


# Identity memo: user_id -> the (name, email) last confirmed in the row. A
# miss costs one read, plus an UPDATE only when a value differs.
_identity_cache = TTLCache[str, UserIdentity](maxsize=1000, ttl=3600)


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
    identity: UserIdentity | None = None,
) -> UserCreateOutcome:
    """Create a user, its default persona and main-agent configuration atomically.

    The insert and provisioning share one transaction, so a user can never be
    left without their singleton main-agent configuration. Deleted ids are
    permanently rejected (see :class:`DeletedUserModel`).

    Args:
        user_id: The stable identifier to provision.
        session: An existing session to reuse; when None a new one is opened
            (and owned) by this function.
        identity: The user's current name and email, stored on creation and
            synced onto an existing row (unknown fields are left untouched).

    Returns:
        UserCreateOutcome.CREATED if the row was newly created, or
        UserCreateOutcome.ALREADY_EXISTS if the user already existed (in which
        case their settings were re-provisioned idempotently).

    Raises:
        ConflictException: If the id belongs to a deleted (tombstoned) user.
        IntegrityError: If the insert failed for a reason other than the row
            already existing (e.g. a constraint violation on another table).
    """
    identity = identity or UserIdentity()
    async with get_async_db_session(session) as session:
        if await _is_user_deleted(user_id, session):
            raise ConflictException("User has been deleted and cannot be re-created")
        try:
            stmt = insert(UserModel).values(id=user_id, **identity.values())
            await session.execute(stmt)
            await provision_main_agent(user_id, session)
            await session.commit()
            _user_cache[user_id] = True
            _user_initialized_cache[user_id] = True
            _identity_cache[user_id] = identity
            return UserCreateOutcome.CREATED
        except IntegrityError:
            # Lost an insert race (or the row pre-existed): roll back and
            # decide by looking the row up again.
            await session.rollback()
            if await session.get(UserModel, user_id) is None:
                # Not a duplicate — some other integrity problem; surface it.
                raise
            await initialize_user_settings(user_id, session)
            await sync_identity(user_id, identity, session)
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
    identity: UserIdentity | None = None,
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
        identity: Name and email to store if the user is created here. Keeping
            an existing row current is :func:`sync_identity`'s job.

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
        await create_user(user_id, session, identity)


async def sync_identity(
    user_id: str,
    identity: UserIdentity,
    session: AsyncSession | None = None,
) -> bool:
    """Bring the row's name and email in line with verified claims.

    Writes only when a known value differs from the stored one: a cache hit
    skips the database entirely, and otherwise the row is read first so that
    unchanged claims take no SQLite write lock. Unknown (missing or blank) values are
    left as stored, so a token without the claims never blanks the copy.

    Args:
        user_id: The user whose copy to refresh; the row should already exist.
        identity: The values from the verified token.
        session: An existing session to reuse; when None a new one is opened.

    Returns:
        True if the row was updated.
    """
    values = identity.values()
    if not values or _identity_cache.get(user_id) == identity:
        return False
    async with get_async_db_session(session) as session:
        stored = (await session.execute(select(UserModel.name, UserModel.email).where(UserModel.id == user_id))).first()
        if stored is None:
            # No row yet: write nothing and cache nothing.
            return False
        changes = {key: value for key, value in values.items() if getattr(stored, key) != value}
        if changes:
            await session.execute(update(UserModel).where(UserModel.id == user_id).values(**changes))
            await session.commit()
            logger.info(f"Updated stored name/email for user {user_id}")
    _identity_cache[user_id] = identity
    return bool(changes)


async def read_identities(user_ids: Iterable[str], session: AsyncSession) -> dict[str, UserIdentity]:
    """The stored names and emails of these users, read live in one query.

    Callers decide what each viewer may see and what to show when a value is
    missing; users without a row are absent from the result.
    """
    wanted = set(user_ids)
    if not wanted:
        return {}
    rows = await session.execute(select(UserModel.id, UserModel.name, UserModel.email).where(UserModel.id.in_(wanted)))
    return {row.id: UserIdentity(name=row.name, email=row.email) for row in rows}


def clear_user_cache() -> None:
    """Drop all cached existence/provisioning/tombstone entries.

    Intended for tests (and process teardown); production code relies on the
    TTL and the targeted updates in :func:`delete_user` instead.
    """
    _user_cache.clear()
    _user_initialized_cache.clear()
    _deleted_cache.clear()
    _identity_cache.clear()


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
    _identity_cache.pop(user_id, None)
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
