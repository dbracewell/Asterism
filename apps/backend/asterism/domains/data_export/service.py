"""Request, build, expire and download a person's data archive (US-86.8, ADR-0076).

One archive per person: a new request replaces the last, and a ready archive
is deleted after ``RETENTION_SECONDS``. Archives are built one at a time in the
background, written beside their final name and renamed when complete, and
stored under ``storage_root/exports/<owner>/``, outside every backed-up tree.
The download is a plain GET with a short-lived signed ticket, so the browser
streams a large archive straight to disk.
"""

import hashlib
import hmac
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from asterism.common.log import get_logger
from asterism.core import config
from asterism.core.exceptions import ConflictException, NotFoundException, UnauthorizedException
from asterism.db.database import get_async_db_session

from .archive import build_archive
from .models import DataExportModel
from .schemas import DataExport, DataExportLink
from .storage import archive_path, export_jobs, exports_root, remove_archives

logger = get_logger("DataExport")

RETENTION_SECONDS = 7 * 24 * 3600
TICKET_SECONDS = 5 * 60
ACTIVE = ("pending", "running")


async def latest_export(user_id: str, session: AsyncSession) -> DataExport | None:
    """The person's archive, unless it has expired (an expired one is deleted)."""
    row = await session.scalar(
        select(DataExportModel)
        .where(DataExportModel.user_id == user_id)
        .order_by(DataExportModel.requested_at.desc(), DataExportModel.id)
    )
    if row is None:
        return None
    if row.expires_at is not None and row.expires_at <= int(time.time()):
        await session.delete(row)
        await session.commit()
        remove_archives(user_id)
        return None
    return DataExport.model_validate(row)


async def request_export(user_id: str, session: AsyncSession) -> DataExport:
    """Start a new archive, replacing the last; refused while one is being built."""
    running = await session.scalar(
        select(DataExportModel.id).where(DataExportModel.user_id == user_id, DataExportModel.status.in_(ACTIVE))
    )
    if running is not None:
        raise ConflictException("Your data is already being prepared")
    await session.execute(delete(DataExportModel).where(DataExportModel.user_id == user_id))
    row = DataExportModel(user_id=user_id, status="pending")
    session.add(row)
    await session.commit()
    remove_archives(user_id, keep=row.id)
    export_jobs.enqueue(user_id, run_export, user_id, row.id)
    return DataExport.model_validate(row)


async def _finish(export_id: uuid.UUID, **values) -> bool:
    """Record the outcome; False when the row is gone (replaced, or the account deleted)."""
    async with get_async_db_session() as session:
        result = await session.execute(update(DataExportModel).where(DataExportModel.id == export_id).values(**values))
        await session.commit()
        return bool(result.rowcount)  # type: ignore[attr-defined]


async def run_export(user_id: str, export_id: uuid.UUID) -> None:
    """Build the archive in the background and record ready or failed."""
    if not await _finish(export_id, status="running"):
        return
    final = archive_path(user_id, export_id)
    partial = final.with_suffix(".partial")
    try:
        final.parent.mkdir(parents=True, exist_ok=True)
        async with get_async_db_session() as session:
            await build_archive(user_id, partial, session, datetime.now(UTC))
        partial.chmod(0o600)
        partial.replace(final)
    except Exception:
        logger.exception("A data export failed")
        partial.unlink(missing_ok=True)
        await _finish(
            export_id,
            status="failed",
            completed_at=int(time.time()),
            error="The archive could not be built. Try again; if it fails again, ask your administrator.",
        )
        return
    except BaseException:
        # Cancelled (shutdown): no partial archive is left; startup marks the export failed.
        partial.unlink(missing_ok=True)
        raise
    now = int(time.time())
    finished = await _finish(
        export_id,
        status="ready",
        completed_at=now,
        expires_at=now + RETENTION_SECONDS,
        size_bytes=final.stat().st_size,
    )
    if not finished:
        final.unlink(missing_ok=True)
    else:
        logger.info("A data export is ready")


async def recover_exports() -> None:
    """At startup: interrupted builds fail, and expired archives are deleted."""
    now = int(time.time())
    async with get_async_db_session() as session:
        await session.execute(
            update(DataExportModel)
            .where(DataExportModel.status.in_(ACTIVE))
            .values(status="failed", completed_at=now, error="Preparing your data was interrupted. Try again.")
        )
        expired = (
            await session.scalars(select(DataExportModel.user_id).where(DataExportModel.expires_at <= now))
        ).all()
        await session.execute(delete(DataExportModel).where(DataExportModel.expires_at <= now))
        await session.commit()
    for user_id in expired:
        remove_archives(user_id)
    for partial in exports_root().glob("*/*.partial"):
        partial.unlink(missing_ok=True)


# --- Download tickets ------------------------------------------------------------


def _signature(export_id: uuid.UUID, user_id: str, expires: int) -> str:
    message = f"data-export:{export_id}:{user_id}:{expires}".encode()
    return hmac.new(config.system_key.encode(), message, hashlib.sha256).hexdigest()


async def download_link(user_id: str, session: AsyncSession) -> DataExportLink:
    current = await latest_export(user_id, session)
    if current is None or current.status != "ready":
        raise NotFoundException("No archive is ready")
    expires = int(time.time()) + TICKET_SECONDS
    ticket = f"{expires}.{_signature(current.id, user_id, expires)}"
    return DataExportLink(
        url=f"/api/py/data-export/{current.id}/archive?ticket={ticket}",
        expires_at=expires,
    )


async def archive_for_ticket(export_id: uuid.UUID, ticket: str, session: AsyncSession) -> Path:
    """The archive file a valid, unexpired ticket names; raises otherwise."""
    from asterism.domains.user.lifecycle import assert_active

    expires_text, _, signature = ticket.partition(".")
    try:
        expires = int(expires_text)
    except ValueError:
        raise UnauthorizedException("This download link is not valid") from None
    row = await session.get(DataExportModel, export_id)
    owner = row.user_id if row is not None else ""
    if expires < int(time.time()) or not hmac.compare_digest(signature, _signature(export_id, owner, expires)):
        raise UnauthorizedException("This download link has expired or is not valid. Start the download again.")
    await assert_active(owner, session)
    current = await latest_export(owner, session)
    path = archive_path(owner, export_id)
    if current is None or current.id != export_id or current.status != "ready" or not path.is_file():
        raise NotFoundException("This archive is no longer available")
    return path
