"""Wire shapes for Download my data."""

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict

DataExportStatus = Literal["pending", "running", "ready", "failed"]


class DataExport(BaseModel):
    """The person's latest archive. ``expires_at`` and ``size_bytes`` are set once ready."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: DataExportStatus
    requested_at: int
    completed_at: int | None = None
    expires_at: int | None = None
    size_bytes: int | None = None
    error: str | None = None


class DataExportState(BaseModel):
    """``export`` is null when nothing was requested or the last archive expired."""

    export: DataExport | None = None


class DataExportLink(BaseModel):
    """A download link for the ready archive; it works for a few minutes."""

    url: str
    expires_at: int
