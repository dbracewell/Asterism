"""Readiness and status shapes."""

from pydantic import BaseModel, Field


class ReadinessCheck(BaseModel):
    name: str
    ok: bool
    detail: str = Field(description="Why a check failed; never a path, secret or internal error text")


class Readiness(BaseModel):
    ready: bool
    checks: list[ReadinessCheck]


class Capacity(BaseModel):
    used: int
    limit: int


class StorageStatus(BaseModel):
    used_bytes: int | None = Field(description="Size of the storage root; None while it is first measured")
    free_bytes: int
    total_bytes: int
    min_free_bytes: int = Field(description="Readiness fails below this")


class LastBackup(BaseModel):
    created_at: int
    archive: str
    size_bytes: int


class InstanceStatus(BaseModel):
    """What the instance is doing now, for Admin Settings → Status."""

    version: str
    commit: str
    schema_revision: str
    started_at: int
    uptime_seconds: int
    log_level: str
    log_format: str
    active_chat_runs: Capacity
    chat_connections: Capacity
    knowledge_running: int
    knowledge_queued: int
    storage: StorageStatus
    last_backup: LastBackup | None
