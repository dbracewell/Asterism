"""Where archives live, the build queue, and removing an account's archives.

Kept apart from the service so account deletion can call it without importing
the account lifecycle back.
"""

import hashlib
import shutil
import uuid
from pathlib import Path

from asterism.common.job_queue import JobManager
from asterism.core import config

# Archives compress whole libraries; one at a time keeps chats responsive.
export_jobs = JobManager(max_concurrency=1)


def exports_root() -> Path:
    return config.storage_root / "exports"


def owner_dir(user_id: str) -> Path:
    # Ids are opaque; hash them so a path segment is always safe.
    return exports_root() / hashlib.sha256(user_id.encode()).hexdigest()[:32]


def archive_path(user_id: str, export_id: uuid.UUID) -> Path:
    return owner_dir(user_id) / f"{export_id}.zip"


def remove_archives(user_id: str, keep: uuid.UUID | None = None) -> None:
    folder = owner_dir(user_id)
    if not folder.is_dir():
        return
    for path in folder.iterdir():
        if keep is None or not path.name.startswith(str(keep)):
            path.unlink(missing_ok=True)


def delete_user_exports(user_id: str) -> None:
    """With the account: stop its build and remove its archives (rows go by cascade)."""
    export_jobs.cancel_task(user_id)
    shutil.rmtree(owner_dir(user_id), ignore_errors=True)
