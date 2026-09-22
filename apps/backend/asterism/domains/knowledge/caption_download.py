"""Admin-initiated local SmolVLM2 model download with lifecycle management.

Downloads the pinned model revision from Hugging Face Hub to the local cache,
generates an integrity manifest, and makes the local caption provider ready.
Only one download runs at a time; supports cancellation and retry.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from asterism.common.hashing import sha256_file

from .captioning import (
    LOCAL_SMOLVLM2_MODEL_ID,
    LOCAL_SMOLVLM2_REVISION,
    CaptionModelStatus,
    DownloadStatus,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pinned model identity — change only after review
# ---------------------------------------------------------------------------
PINNED_MODEL_ID = LOCAL_SMOLVLM2_MODEL_ID
PINNED_REVISION = LOCAL_SMOLVLM2_REVISION

# Files needed for transformers inference (excludes ONNX variants, README, etc.)
PINNED_ALLOW_PATTERNS = [
    "*.json",
    "*.safetensors",
    "merges.txt",
    "vocab.json",
]
PINNED_IGNORE_PATTERNS = [
    "onnx/*",
    "README.md",
    ".gitattributes",
]

# Approximate total download size of the allowed files (bytes).
# Used only for progress estimation; not a hard check.
EXPECTED_DOWNLOAD_BYTES = 515_000_000

MANIFEST_FILENAME = "manifest.json"
MAX_MANIFEST_BYTES = 1024 * 1024


# ---------------------------------------------------------------------------
# Manifest generation — shared with provision_local_caption_bundle.py
# ---------------------------------------------------------------------------


def build_manifest(model_root: Path, *, model_id: str, revision: str) -> dict[str, object]:
    """Build an integrity manifest for all regular files under *model_root*.

    Returns a dictionary suitable for JSON serialisation.  Raises ``ValueError``
    when the root is empty or parameters are blank.
    """
    root = model_root.resolve()
    if not root.is_dir():
        raise ValueError("Model root does not exist")
    if not model_id.strip() or not revision.strip():
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
    return {"model_id": model_id.strip(), "revision": revision.strip(), "files": files}


def write_manifest(model_root: Path, *, model_id: str, revision: str) -> str:
    """Build, write, and return the SHA-256 of the manifest file."""
    manifest = build_manifest(model_root, model_id=model_id, revision=revision)
    destination = model_root / MANIFEST_FILENAME
    destination.write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )
    return sha256_file(destination)


# ---------------------------------------------------------------------------
# Directory size helper
# ---------------------------------------------------------------------------


def _directory_size(root: Path) -> int:
    """Total bytes of regular files under *root*, ignoring symlinks."""
    if not root.is_dir():
        return 0
    total = 0
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            try:
                total += path.stat().st_size
            except OSError:
                pass
    return total


# ---------------------------------------------------------------------------
# Download service
# ---------------------------------------------------------------------------


@dataclass
class _DownloadState:
    """Mutable internal state for the download lifecycle."""

    status: DownloadStatus = DownloadStatus.IDLE
    error: str | None = None
    bundle_sha256: str | None = None
    task: asyncio.Task[str] | None = None


class CaptionModelDownloadService:
    """Manages the download lifecycle for the local SmolVLM2 caption model.

    Designed as a singleton service owned by the knowledge runtime.
    """

    def __init__(
        self,
        model_root: Path,
        *,
        on_bundle_ready: OnBundleReady | None = None,
    ) -> None:
        self._model_root = model_root.resolve()
        self._state = _DownloadState()
        self._on_bundle_ready = on_bundle_ready
        # If a verified bundle already exists on disk, mark ready immediately.
        self._check_existing_bundle()

    # -- Public API --------------------------------------------------------

    def status(self) -> CaptionModelStatus:
        """Return the current download/readiness status."""
        is_downloading = self._state.status == DownloadStatus.DOWNLOADING
        return CaptionModelStatus(
            status=self._state.status,
            bytes_downloaded=_directory_size(self._model_root) if is_downloading else 0,
            total_bytes=EXPECTED_DOWNLOAD_BYTES if is_downloading else 0,
            error=self._state.error,
            bundle_sha256=self._state.bundle_sha256,
        )

    async def start_download(self) -> CaptionModelStatus:
        """Begin downloading the pinned model revision.

        Returns the initial status.  Raises ``RuntimeError`` if a download
        is already in progress.
        """
        if self._state.status == DownloadStatus.DOWNLOADING:
            raise RuntimeError("A download is already in progress")
        if self._state.status == DownloadStatus.READY:
            return self.status()

        self._state.status = DownloadStatus.DOWNLOADING
        self._state.error = None
        self._state.bundle_sha256 = None
        self._state.task = asyncio.create_task(self._run_download())
        self._state.task.add_done_callback(self._on_task_done)
        logger.info("Caption model download started for %s@%s", PINNED_MODEL_ID, PINNED_REVISION[:12])
        return self.status()

    async def cancel_download(self) -> CaptionModelStatus:
        """Cancel an active download and return updated status."""
        if self._state.task is not None and not self._state.task.done():
            self._state.task.cancel()
            try:
                await self._state.task
            except (asyncio.CancelledError, Exception):
                pass
        if self._state.status == DownloadStatus.DOWNLOADING:
            self._state.status = DownloadStatus.IDLE
            self._state.error = None
            logger.info("Caption model download cancelled")
        return self.status()

    async def shutdown(self) -> None:
        """Cancel any active download during application shutdown."""
        await self.cancel_download()

    # -- Internal ----------------------------------------------------------

    def _check_existing_bundle(self) -> None:
        """Mark an existing bundle ready only after full pinned-manifest verification."""
        manifest_path = self._model_root / MANIFEST_FILENAME
        if not manifest_path.is_file():
            return
        try:
            if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
                return
            manifest_bytes = manifest_path.read_bytes()
            manifest = json.loads(manifest_bytes)
            if (
                manifest.get("model_id") != PINNED_MODEL_ID
                or manifest.get("revision") != PINNED_REVISION
            ):
                return
            files = manifest.get("files")
            if not isinstance(files, dict) or not files:
                return
            for relative_path, expected_sha256 in files.items():
                if not isinstance(relative_path, str) or not isinstance(expected_sha256, str):
                    return
                path = (self._model_root / relative_path).resolve()
                if self._model_root not in path.parents or not path.is_file():
                    return
                if sha256_file(path) != expected_sha256.lower():
                    return
            self._state.status = DownloadStatus.READY
            self._state.bundle_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
            logger.info("Existing caption model bundle detected: %s", self._state.bundle_sha256[:16])
        except (OSError, json.JSONDecodeError, TypeError):
            return

    def _download_sync(self) -> str:
        """Synchronous download + manifest generation.  Returns bundle SHA-256."""
        from huggingface_hub import snapshot_download

        self._model_root.mkdir(parents=True, exist_ok=True)

        snapshot_download(
            PINNED_MODEL_ID,
            revision=PINNED_REVISION,
            local_dir=str(self._model_root),
            local_files_only=False,
            allow_patterns=PINNED_ALLOW_PATTERNS,
            ignore_patterns=PINNED_IGNORE_PATTERNS,
        )

        return write_manifest(
            self._model_root,
            model_id=PINNED_MODEL_ID,
            revision=PINNED_REVISION,
        )

    async def _run_download(self) -> str:
        """Background task: download, verify, persist."""
        try:
            bundle_sha256 = await asyncio.to_thread(self._download_sync)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._state.status = DownloadStatus.FAILED
            self._state.error = str(exc)[:500]
            logger.error("Caption model download failed: %s", exc)
            raise

        self._state.status = DownloadStatus.VERIFYING
        # Verification is the manifest generation itself — already done in
        # _download_sync.  Mark ready.
        self._state.status = DownloadStatus.READY
        self._state.bundle_sha256 = bundle_sha256
        self._state.error = None
        logger.info("Caption model download complete: %s", bundle_sha256[:16])

        if self._on_bundle_ready:
            await self._on_bundle_ready(bundle_sha256)

        return bundle_sha256

    def _on_task_done(self, task: asyncio.Task[str]) -> None:
        """Callback to clear the task reference and handle cancellation."""
        self._state.task = None
        if task.cancelled() and self._state.status == DownloadStatus.DOWNLOADING:
            self._state.status = DownloadStatus.IDLE
            self._state.error = None


# Callback type for notifying the runtime when the bundle is ready.
type OnBundleReady = Callable[[str], Coroutine[Any, Any, None]]
