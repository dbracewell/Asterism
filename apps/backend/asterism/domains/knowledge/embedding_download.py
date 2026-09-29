"""Automatic, pinned provisioning for the local knowledge embedding bundle."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
import tempfile
import threading
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from asterism.common.hashing import sha256_file

logger = logging.getLogger(__name__)

PINNED_MODEL_ID = "Xenova/clip-vit-base-patch32"
# Reviewed repository commit containing the combined quantized CLIP graph.
PINNED_REVISION = "dcb5f6119fdbb94f1053e98bd74da0ac582ed2a7"
MODEL_FILENAME = "model.onnx"
SOURCE_MODEL_FILENAME = "onnx/model_quantized.onnx"
REQUIRED_FILES = (
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.json",
    "merges.txt",
    MODEL_FILENAME,
)
ALLOW_PATTERNS = [*REQUIRED_FILES[:-1], SOURCE_MODEL_FILENAME]
MANIFEST_FILENAME = "manifest.json"
MAX_MANIFEST_BYTES = 1024 * 1024


class EmbeddingModelStatus(BaseModel):
    """Safe, admin-readable provisioning state; never exposes bundle bytes."""

    model_config = ConfigDict(frozen=True)

    status: Literal["idle", "downloading", "verifying", "ready", "failed"]
    model_id: str = PINNED_MODEL_ID
    revision: str = PINNED_REVISION
    bytes_downloaded: int = 0
    total_bytes: int = 0
    error: str | None = None
    bundle_sha256: str | None = None


class EmbeddingBundleNotReadyError(RuntimeError):
    """Expected transient state while automatic provisioning is in progress."""


@dataclass
class _State:
    status: Literal["idle", "downloading", "verifying", "ready", "failed"] = "idle"
    error: str | None = None
    bundle_sha256: str | None = None
    task: asyncio.Task[str] | None = None
    staging_root: Path | None = None
    cancel_requested: threading.Event | None = None


def _directory_size(root: Path) -> int:
    if not root.is_dir():
        return 0
    return sum(path.stat().st_size for path in root.rglob("*") if path.is_file() and not path.is_symlink())


class EmbeddingModelDownloadService:
    """Owns exactly one staged, verified download of the reviewed CLIP bundle."""

    def __init__(
        self,
        model_root: Path,
        *,
        artifact_sha256: str,
        artifact_size_bytes: int,
        on_bundle_ready: OnBundleReady | None = None,
    ) -> None:
        self._model_root = model_root.resolve()
        self._artifact_sha256 = artifact_sha256.lower()
        self._artifact_size_bytes = artifact_size_bytes
        self._on_bundle_ready = on_bundle_ready
        self._state = _State()
        self._check_existing_bundle()

    def status(self) -> EmbeddingModelStatus:
        downloading = self._state.status in {"downloading", "verifying"}
        progress_root = self._state.staging_root if downloading else None
        return EmbeddingModelStatus(
            status=self._state.status,
            bytes_downloaded=_directory_size(progress_root) if progress_root else 0,
            total_bytes=self._artifact_size_bytes if downloading else 0,
            error=self._state.error,
            bundle_sha256=self._state.bundle_sha256,
        )

    def is_ready(self) -> bool:
        return self._state.status == "ready"

    async def start_download(self) -> EmbeddingModelStatus:
        if self._state.status == "ready" or self._state.status in {"downloading", "verifying"}:
            return self.status()
        parent = self._model_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        self._state = _State(
            status="downloading",
            staging_root=Path(tempfile.mkdtemp(prefix="knowledge-clip-", dir=parent)),
            cancel_requested=threading.Event(),
        )
        self._state.task = asyncio.create_task(self._run_download())
        self._state.task.add_done_callback(self._clear_task)
        logger.info("Knowledge embedding bundle provisioning started: %s@%s", PINNED_MODEL_ID, PINNED_REVISION[:12])
        return self.status()

    async def cancel_download(self) -> EmbeddingModelStatus:
        if self._state.cancel_requested is not None:
            self._state.cancel_requested.set()
        if self._state.task is not None and not self._state.task.done():
            self._state.task.cancel()
            try:
                await self._state.task
            except (asyncio.CancelledError, Exception):
                pass
        if self._state.status in {"downloading", "verifying"}:
            self._state = _State()
        return self.status()

    async def shutdown(self) -> None:
        await self.cancel_download()

    def _validate_bundle(self, root: Path) -> str:
        if not root.is_dir() or any(
            not (root / name).is_file() or (root / name).is_symlink() for name in REQUIRED_FILES
        ):
            raise ValueError("Required reviewed embedding files are missing")
        model = root / MODEL_FILENAME
        if model.stat().st_size != self._artifact_size_bytes or sha256_file(model) != self._artifact_sha256:
            raise ValueError("Reviewed embedding ONNX artifact failed integrity verification")
        files = {name: sha256_file(root / name) for name in REQUIRED_FILES}
        manifest = {
            "model_id": PINNED_MODEL_ID,
            "revision": PINNED_REVISION,
            "files": files,
        }
        content = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        (root / MANIFEST_FILENAME).write_bytes(content)
        return hashlib.sha256(content).hexdigest()

    def _check_existing_bundle(self) -> None:
        backup = self._model_root.with_name(f"{self._model_root.name}.previous")
        if not self._model_root.exists() and backup.is_dir():
            backup.replace(self._model_root)
        manifest_path = self._model_root / MANIFEST_FILENAME
        try:
            if not manifest_path.is_file() or manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
                return
            manifest_bytes = manifest_path.read_bytes()
            manifest = json.loads(manifest_bytes)
            if manifest.get("model_id") != PINNED_MODEL_ID or manifest.get("revision") != PINNED_REVISION:
                return
            files = manifest.get("files")
            if not isinstance(files, dict) or set(files) != set(REQUIRED_FILES):
                return
            if any(
                not isinstance(value, str)
                or not (self._model_root / name).is_file()
                or (self._model_root / name).is_symlink()
                or sha256_file(self._model_root / name) != value
                for name, value in files.items()
            ):
                return
            self._validate_bundle(self._model_root)
            self._state = _State(status="ready", bundle_sha256=hashlib.sha256(manifest_bytes).hexdigest())
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return

    def _download_sync(self, stage: Path, cancel_requested: threading.Event) -> str:
        from huggingface_hub import snapshot_download

        parent = self._model_root.parent
        parent.mkdir(parents=True, exist_ok=True)
        try:
            snapshot_download(
                PINNED_MODEL_ID,
                revision=PINNED_REVISION,
                local_dir=str(stage),
                allow_patterns=ALLOW_PATTERNS,
                local_files_only=False,
            )
            if cancel_requested.is_set():
                raise EmbeddingBundleNotReadyError("Knowledge embedding bundle provisioning was cancelled")
            source = stage / SOURCE_MODEL_FILENAME
            if not source.is_file():
                raise ValueError("Reviewed embedding ONNX artifact was not downloaded")
            source.replace(stage / MODEL_FILENAME)
            shutil.rmtree(stage / "onnx")
            bundle_sha256 = self._validate_bundle(stage)
            if cancel_requested.is_set():
                raise EmbeddingBundleNotReadyError("Knowledge embedding bundle provisioning was cancelled")
            backup = self._model_root.with_name(f"{self._model_root.name}.previous")
            if backup.exists():
                shutil.rmtree(backup)
            if self._model_root.exists():
                self._model_root.replace(backup)
            stage.replace(self._model_root)
            if backup.exists():
                shutil.rmtree(backup)
            return bundle_sha256
        finally:
            if stage.exists():
                shutil.rmtree(stage, ignore_errors=True)

    async def _run_download(self) -> str:
        try:
            stage = self._state.staging_root
            cancel_requested = self._state.cancel_requested
            if stage is None or cancel_requested is None:
                raise RuntimeError("Embedding bundle download was not initialized")
            bundle_sha256 = await asyncio.to_thread(self._download_sync, stage, cancel_requested)
            self._state.status = "verifying"
            self._check_existing_bundle()
            if not self.is_ready():
                raise ValueError("Downloaded embedding bundle did not pass verification")
            self._state.bundle_sha256 = bundle_sha256
            if self._on_bundle_ready:
                await self._on_bundle_ready(bundle_sha256)
            return bundle_sha256
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self._state.status = "failed"
            self._state.error = "Embedding bundle download failed; check server logs"
            logger.exception("Knowledge embedding bundle provisioning failed")
            raise error

    def _clear_task(self, task: asyncio.Task[str]) -> None:
        self._state.task = None
        if task.cancelled():
            return
        # The status object is the caller-facing failure channel. Retrieve the
        # exception here so a failed automatic startup task never becomes an
        # unhandled asyncio task exception.
        try:
            task.result()
        except Exception:
            return


type OnBundleReady = Callable[[str], Coroutine[Any, Any, None]]
