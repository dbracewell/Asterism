"""Readiness checks and the admin status snapshot (US-86.6, ADR-0074).

Readiness answers "can this instance serve right now?" for the container
health check and load balancers: the backend database takes a write lock, the
storage disk has the configured free space, and the auth signing keys can be
loaded from the frontend. It runs without authentication, so it reports only
pass/fail and a short reason. The frontend's ``/api/health`` checks the Better
Auth database and that its signing key works.
"""

import asyncio
import json
import os
import shutil
import sqlite3
import time
from pathlib import Path

from asterism.common.log import log_settings
from asterism.core import config
from asterism.core.build_info import app_commit, app_version
from asterism.db.init_db import sqlite_database_path
from asterism.db.migrate import head_revision

from .schemas import (
    Capacity,
    InstanceStatus,
    LastBackup,
    Readiness,
    ReadinessCheck,
    StorageStatus,
)

STARTED_AT = int(time.time())
LAST_BACKUP = ".last-backup.json"
STORAGE_SIZE_TTL_SECONDS = 300

_storage_size: tuple[float, int] | None = None
_measuring: asyncio.Task[int] | None = None


def _database_writable(path: Path) -> None:
    connection = sqlite3.connect(path, timeout=1.5)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("ROLLBACK")
    finally:
        connection.close()


async def _check_database() -> ReadinessCheck:
    try:
        path = sqlite_database_path()
        if not path.is_file():
            return ReadinessCheck(name="database", ok=False, detail="The backend database is missing")
        await asyncio.to_thread(_database_writable, path)
    except sqlite3.OperationalError as error:
        busy = "locked" in str(error) or "busy" in str(error)
        detail = "The backend database is busy" if busy else "The backend database is not writable"
        return ReadinessCheck(name="database", ok=False, detail=detail)
    except Exception:
        return ReadinessCheck(name="database", ok=False, detail="The backend database could not be opened")
    return ReadinessCheck(name="database", ok=True, detail="")


def _check_storage() -> ReadinessCheck:
    try:
        free = shutil.disk_usage(config.storage_root).free
    except OSError:
        return ReadinessCheck(name="storage", ok=False, detail="The storage root is not readable")
    if free < config.min_free_storage_bytes:
        return ReadinessCheck(name="storage", ok=False, detail="Storage free space is below the minimum")
    return ReadinessCheck(name="storage", ok=True, detail="")


async def _check_auth_keys() -> ReadinessCheck:
    from asterism.core.security import jwks_client

    try:
        keys = await asyncio.wait_for(asyncio.to_thread(jwks_client.get_signing_keys), timeout=2.5)
    except Exception:
        return ReadinessCheck(name="auth_keys", ok=False, detail="The auth signing keys could not be loaded")
    if not keys:
        return ReadinessCheck(name="auth_keys", ok=False, detail="There are no auth signing keys")
    return ReadinessCheck(name="auth_keys", ok=True, detail="")


async def readiness() -> Readiness:
    # Concurrent, so the container health check (3 s per request) is not the sum of the waits.
    database, auth_keys = await asyncio.gather(_check_database(), _check_auth_keys())
    checks = [database, _check_storage(), auth_keys]
    return Readiness(ready=all(check.ok for check in checks), checks=checks)


def _directory_size(root: Path) -> int:
    total = 0
    for directory, _, files in os.walk(root):
        for name in files:
            try:
                total += os.lstat(os.path.join(directory, name)).st_size
            except OSError:
                continue
    return total


async def _storage_used() -> int | None:
    """The storage root's size, measured in the background at most every five minutes."""
    global _storage_size, _measuring
    now = time.monotonic()
    if _storage_size is not None and now - _storage_size[0] < STORAGE_SIZE_TTL_SECONDS:
        return _storage_size[1]
    if _measuring is None or _measuring.done():

        async def measure() -> int:
            global _storage_size
            size = await asyncio.to_thread(_directory_size, config.storage_root)
            _storage_size = (time.monotonic(), size)
            return size

        _measuring = asyncio.create_task(measure())
    try:
        # A small instance answers at once; a large one shows the last value meanwhile.
        return await asyncio.wait_for(asyncio.shield(_measuring), timeout=2)
    except TimeoutError:
        return _storage_size[1] if _storage_size is not None else None


def _last_backup() -> LastBackup | None:
    try:
        return LastBackup.model_validate(json.loads((config.storage_root / LAST_BACKUP).read_text()))
    except (OSError, ValueError):
        return None


async def instance_status() -> InstanceStatus:
    from asterism.domains.chat.jobs import chat_jobs
    from asterism.domains.knowledge.runtime import job_manager

    usage = shutil.disk_usage(config.storage_root)
    level, fmt = log_settings()
    now = int(time.time())
    return InstanceStatus(
        version=app_version(),
        commit=app_commit(),
        schema_revision=head_revision(),
        started_at=STARTED_AT,
        uptime_seconds=max(now - STARTED_AT, 0),
        log_level=level,
        log_format=fmt,
        active_chat_runs=Capacity(used=chat_jobs.active_count, limit=chat_jobs.limits.active_jobs),
        chat_connections=Capacity(used=chat_jobs.controller_count, limit=chat_jobs.limits.controllers),
        knowledge_running=job_manager.running,
        knowledge_queued=job_manager.queued,
        storage=StorageStatus(
            used_bytes=await _storage_used(),
            free_bytes=usage.free,
            total_bytes=usage.total,
            min_free_bytes=config.min_free_storage_bytes,
        ),
        last_backup=_last_backup(),
    )
