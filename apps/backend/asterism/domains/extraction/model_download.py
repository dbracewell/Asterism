import asyncio
import json
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from asterism.common.file_utils import calculate_directory_size
from asterism.common.hashing import sha256_file
from asterism.common.log import get_logger

logger = get_logger(__name__)

type OnBundleReady = Callable[[str], Coroutine[Any, Any, None]]
type DownloadStatus = Literal["idle", "downloading", "verifying", "ready", "failed"]


@dataclass
class PinnedModel:
    id: str
    revision: str
    allow_patterns: list[str]
    ignore_patterns: list[str] = field(default_factory=list)
    source_filename: str | None = None
    filename: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None


@dataclass
class DownloadState:
    status: DownloadStatus = "idle"
    error: str | None = None
    task: asyncio.Task[str] | None = None
    cancel_requested: threading.Event | None = None


@dataclass
class DownloadProgress:
    status: DownloadStatus = "idle"
    bytes_downloaded: int = 0
    total_bytes: int = 0
    error: str | None = None
    bundle_sha256: str | None = None


MANIFEST_FILENAME = "manifest.json"
MAX_MANIFEST_BYTES = 1024 * 1024


def build_manifest(model_root: Path, model: PinnedModel) -> dict[str, object]:
    """Build an integrity manifest for all regular files under *model_root*.

    Returns a dictionary suitable for JSON serialisation.  Raises ``ValueError``
    when the root is empty or parameters are blank.
    """
    root = model_root.resolve()
    if not root.is_dir():
        raise ValueError("Model root does not exist")
    if not model.id.strip() or not model.revision.strip():
        raise ValueError("Model ID and reviewed revision are required")

    files: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.name == MANIFEST_FILENAME:
            continue
        if not path.is_file() or path.is_symlink():
            continue
        files[str(path.relative_to(root))] = sha256_file(path)

    if not files:
        raise ValueError("Model root contains no regular files")

    return {"model_id": model.id.strip(), "revision": model.revision.strip(), "files": files}


def write_manifest(model_root: Path, model: PinnedModel) -> str:
    """Build, write, and return the SHA-256 of the manifest file."""
    manifest = build_manifest(
        model_root,
        model,
    )
    destination = model_root / MANIFEST_FILENAME
    destination.write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    return sha256_file(destination)


def verify_manifest(model_root: Path, model: PinnedModel) -> bool:
    """Verify the integrity of all regular files under *model_root* against the manifest.

    Returns ``True`` if the manifest is present and all files match their expected
    SHA-256 digests.  Returns ``False`` if the manifest is missing or any file fails
    verification.
    """
    root = model_root.resolve()
    manifest_path = root / MANIFEST_FILENAME
    if not manifest_path.is_file() or manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
        return False

    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        if manifest.get("model_id") != model.id or manifest.get("revision") != model.revision:
            return False

        files = manifest.get("files")
        if not isinstance(files, dict) or not files:
            return False

        for relative_path, expected_sha256 in files.items():
            if not isinstance(relative_path, str) or not isinstance(expected_sha256, str):
                return False

            path = (root / relative_path).resolve()
            if root not in path.parents or not path.is_file():
                return False

            if sha256_file(path) != expected_sha256.lower():
                return False

        return True
    except (OSError, json.JSONDecodeError, TypeError):
        return False


class DownloadNotReadyError(RuntimeError):
    """Expected transient state while automatic provisioning is in progress."""


@dataclass
class ModelDownloadService:
    model_root: Path
    pinned_model: PinnedModel
    on_bundle_ready: OnBundleReady | None = None
    state: DownloadState = field(default_factory=DownloadState)

    def __post_init__(self) -> None:
        self.model_root = self.model_root.resolve()
        self._check_existing_bundle()

    def _check_existing_bundle(self) -> None:
        """Mark an existing bundle ready only after full pinned-manifest verification."""
        if verify_manifest(self.model_root, self.pinned_model):
            self.state = DownloadState(
                status="ready",
            )
            logger.info(
                f"Existing model bundle detected: {self.pinned_model.id}",
            )

    async def cancel_download(self) -> DownloadProgress:
        if self.state.cancel_requested is not None:
            self.state.cancel_requested.set()

        if self.state.task is not None and not self.state.task.done():
            self.state.task.cancel()
            try:
                await self.state.task
            except (asyncio.CancelledError, Exception):
                pass

        if self.state.status in {"downloading", "verifying"}:
            self.state = DownloadState(status="idle")

        return DownloadProgress(status=self.state)

    async def start_download(self) -> DownloadProgress:
        if self.state.status == "ready" or self.state.status in {"downloading", "verifying"}:
            return DownloadProgress(
                status=self.state.status,
                bytes_downloaded=calculate_directory_size(self.model_root.resolve()),
                total_bytes=self.pinned_model.size_bytes if self.pinned_model.size_bytes is not None else 0,
                error=self.state.error,
            )

        parent = self.model_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        self.state = DownloadState(
            status="downloading",
            cancel_requested=threading.Event(),
        )
        self.state.task = asyncio.create_task(self._run_download())
        self.state.task.add_done_callback(self._clear_task)
        return DownloadProgress(
            status=self.state.status,
            bytes_downloaded=calculate_directory_size(self.model_root.resolve()),
            total_bytes=self.pinned_model.size_bytes if self.pinned_model.size_bytes is not None else 0,
            error=self.state.error,
        )

    def _download_sync(self, cancel_requested: threading.Event) -> str:
        from huggingface_hub import snapshot_download

        parent = self.model_root.parent
        parent.mkdir(parents=True, exist_ok=True)

        allow_patterns = [*self.pinned_model.allow_patterns]
        if self.pinned_model.source_filename:
            allow_patterns.append(self.pinned_model.source_filename)

        snapshot_download(
            self.pinned_model.id,
            revision=self.pinned_model.revision,
            local_dir=str(self.model_root),
            allow_patterns=allow_patterns,
            ignore_patterns=self.pinned_model.ignore_patterns or [],
            local_files_only=False,
        )
        if cancel_requested.is_set():
            raise DownloadNotReadyError("Download  was cancelled")

        if self.pinned_model.source_filename and self.pinned_model.filename:
            source_path = self.model_root / self.pinned_model.source_filename
            dest_path = self.model_root / self.pinned_model.filename
            if not source_path.is_file():
                raise DownloadNotReadyError(f"Download is missing source file: {source_path}")
            source_path.rename(dest_path)

        return write_manifest(
            self.model_root,
            self.pinned_model,
        )

    async def _run_download(self) -> str:
        try:
            cancel_requested = self.state.cancel_requested
            if self.state.cancel_requested is None:
                raise RuntimeError("Download was not initialized")

            bundle_sha256 = await asyncio.to_thread(self._download_sync, cancel_requested)
            self.state.status = "verifying"
            self._check_existing_bundle()
            if not self.is_ready():
                raise ValueError("Downloaded bundle did not pass verification")

            if self.on_bundle_ready:
                await self.on_bundle_ready(bundle_sha256)

            return bundle_sha256
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.state.status = "failed"
            self.state.error = "Embedding bundle download failed; check server logs"
            logger.exception("Bundle provisioning failed", error)
            raise error

    def _clear_task(self, task: asyncio.Task[str]) -> None:
        self.state.task = None
        if task.cancelled() and self.state.status == "downloading":
            self.state.status = "idle"
            self.state.error = None
            return

        # The status object is the caller-facing failure channel. Retrieve the
        # exception here so a failed automatic startup task never becomes an
        # unhandled asyncio task exception.
        try:
            task.result()
        except Exception:
            return

    def progress(self) -> DownloadProgress:
        downloading = self.state.status in {"downloading", "verifying"}
        self.model_root.resolve().mkdir(exist_ok=True, parents=True)
        return DownloadProgress(
            status=self.state.status,
            bytes_downloaded=calculate_directory_size(self.model_root.resolve()) if self.model_root else 0,
            total_bytes=self.pinned_model.size_bytes if downloading and self.pinned_model.size_bytes is not None else 0,
            error=self.state.error,
        )

    def is_ready(self) -> bool:
        return self.state.status == "ready"

    async def shutdown(self) -> None:
        await self.cancel_download()
