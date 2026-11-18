"""Readiness and Admin Settings → Status (US-86.6)."""

import json
import sqlite3
from collections import namedtuple

import pytest
import pytest_asyncio
from asterism.core import config
from asterism.core.schemas import AuthedUser
from asterism.db.init_db import initialize_database
from asterism.domains.status import service
from test_projects_api import auth
from test_projects_api import project_api as _project_api

project_api = _project_api
Usage = namedtuple("Usage", "total used free")


@pytest_asyncio.fixture
async def instance(tmp_path, monkeypatch):
    """A migrated database, with auth keys the backend can load."""
    monkeypatch.setattr(config, "storage_root", tmp_path)
    monkeypatch.setattr(config, "db_url", f"sqlite+aiosqlite:///{tmp_path / 'database.db'}")
    await initialize_database()
    monkeypatch.setattr("asterism.core.security.jwks_client.get_signing_keys", lambda: ["key"])
    monkeypatch.setattr(config, "min_free_storage_bytes", 1024)
    return tmp_path


def checks(result) -> dict[str, tuple[bool, str]]:
    return {check.name: (check.ok, check.detail) for check in result.checks}


@pytest.mark.asyncio
async def test_ready_when_database_storage_and_keys_are_fine(instance):
    result = await service.readiness()
    assert result.ready and checks(result) == {
        "database": (True, ""),
        "storage": (True, ""),
        "auth_keys": (True, ""),
    }


@pytest.mark.asyncio
async def test_each_failure_is_named_without_internal_detail(instance, monkeypatch):
    monkeypatch.setattr(config, "min_free_storage_bytes", 10**18)
    monkeypatch.setattr(
        "asterism.core.security.jwks_client.get_signing_keys",
        lambda: (_ for _ in ()).throw(RuntimeError("http://frontend:3001/api/auth/jwks refused")),
    )
    result = await service.readiness()
    assert not result.ready
    found = checks(result)
    assert found["storage"] == (False, "Storage free space is below the minimum")
    assert found["auth_keys"] == (False, "The auth signing keys could not be loaded")
    assert "frontend" not in result.model_dump_json()

    (instance / "database.db").unlink()
    assert checks(await service.readiness())["database"] == (False, "The backend database is missing")


@pytest.mark.asyncio
async def test_a_held_write_lock_reads_as_busy(instance):
    holder = sqlite3.connect(instance / "database.db", check_same_thread=False)
    holder.execute("BEGIN IMMEDIATE")
    try:
        assert checks(await service.readiness())["database"] == (False, "The backend database is busy")
    finally:
        holder.rollback()
        holder.close()


@pytest.mark.asyncio
async def test_readiness_endpoint_is_public_and_says_503_when_not_ready(project_api, monkeypatch):
    client, _, _ = project_api
    from asterism.domains.status.schemas import Readiness, ReadinessCheck

    async def not_ready():
        return Readiness(ready=False, checks=[ReadinessCheck(name="storage", ok=False, detail="low")])

    monkeypatch.setattr(service, "readiness", not_ready)
    response = await client.get("/health/ready")
    assert response.status_code == 503 and response.json()["ready"] is False
    assert response.headers["x-request-id"]


@pytest.mark.asyncio
async def test_admin_status_reports_runtime_storage_and_last_backup(project_api, monkeypatch, tmp_path):
    client, _, _ = project_api
    monkeypatch.setattr(config, "storage_root", tmp_path)
    (tmp_path / "files").mkdir()
    (tmp_path / "files" / "a.bin").write_bytes(b"x" * 2048)
    (tmp_path / ".last-backup.json").write_text(
        json.dumps({"created_at": 1_795_000_000, "archive": "asterism-backup-x.tar.gz", "size_bytes": 99})
    )
    monkeypatch.setattr(service.shutil, "disk_usage", lambda _: Usage(total=10_000, used=4_000, free=6_000))
    service._storage_size = None

    assert (await client.get("/status", headers=auth())).status_code == 401
    monkeypatch.setattr(
        "asterism.core.security.verify_jwks_token",
        lambda token: AuthedUser(id=token, email=f"{token}@example.test", name=token, role="admin"),
    )
    body = (await client.get("/status", headers=auth("root"))).json()
    assert body["uptime_seconds"] >= 0 and body["schema_revision"]
    assert body["active_chat_runs"]["limit"] == config.max_active_chat_jobs
    assert body["chat_connections"]["limit"] == config.max_chat_controllers
    assert (body["knowledge_running"], body["knowledge_queued"]) == (0, 0)
    assert body["storage"] | {"used_bytes": None} == {
        "used_bytes": None,
        "free_bytes": 6_000,
        "total_bytes": 10_000,
        "min_free_bytes": config.min_free_storage_bytes,
    }
    assert body["storage"]["used_bytes"] >= 2048
    assert body["last_backup"] == {"created_at": 1_795_000_000, "archive": "asterism-backup-x.tar.gz", "size_bytes": 99}
    assert body["log_level"] in ("DEBUG", "INFO", "WARNING", "ERROR")


@pytest.mark.asyncio
async def test_knowledge_queue_counts_running_and_waiting_jobs():
    import asyncio

    from asterism.common.job_queue import JobManager

    jobs = JobManager(max_concurrency=1)
    release = asyncio.Event()

    async def work():
        await release.wait()

    for key in ("a", "b", "c"):
        jobs.enqueue(key, work)
    await asyncio.sleep(0)
    assert (jobs.running, jobs.queued) == (1, 2)
    release.set()
    await jobs.shutdown()
    assert (jobs.running, jobs.queued) == (0, 0)


def test_backups_record_when_they_ran(tmp_path, monkeypatch):
    """`backup create` leaves a marker the status view reads (it is not part of any archive)."""
    from datetime import UTC, datetime

    from asterism.backup.archive import StorageLayout
    from asterism.backup.create import record_last_backup

    layout = StorageLayout(storage_root=tmp_path, backend_db=tmp_path / "d.db", auth_db=tmp_path / "u.db")
    archive = tmp_path / "asterism-backup-20261118T030000Z.tar.gz"
    archive.write_bytes(b"12345")
    record_last_backup(layout, archive, datetime(2026, 11, 18, 3, tzinfo=UTC))
    monkeypatch.setattr(config, "storage_root", tmp_path)
    assert service._last_backup().model_dump() == {  # type: ignore[union-attr]
        "created_at": int(datetime(2026, 11, 18, 3, tzinfo=UTC).timestamp()),
        "archive": archive.name,
        "size_bytes": 5,
    }
