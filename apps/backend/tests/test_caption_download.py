"""Tests for the admin-initiated local caption model download service."""

import asyncio
import hashlib
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from asterism.domains.knowledge.caption_download import (
    MANIFEST_FILENAME,
    PINNED_MODEL_ID,
    PINNED_REVISION,
    CaptionModelDownloadService,
    build_manifest,
    write_manifest,
)
from asterism.domains.knowledge.captioning import DownloadStatus

# ---------------------------------------------------------------------------
# Manifest generation
# ---------------------------------------------------------------------------


class TestBuildManifest:
    def test_builds_manifest_from_regular_files(self, tmp_path: Path):
        (tmp_path / "weights.safetensors").write_bytes(b"model weights")
        (tmp_path / "config.json").write_text('{"key": "value"}')
        manifest = build_manifest(tmp_path, model_id="test/model", revision="abc123")
        assert manifest["model_id"] == "test/model"
        assert manifest["revision"] == "abc123"
        assert "weights.safetensors" in manifest["files"]
        assert "config.json" in manifest["files"]
        assert len(manifest["files"]) == 2

    def test_excludes_manifest_file_itself(self, tmp_path: Path):
        (tmp_path / "weights.safetensors").write_bytes(b"model weights")
        (tmp_path / MANIFEST_FILENAME).write_text("{}")
        manifest = build_manifest(tmp_path, model_id="test/model", revision="abc123")
        assert MANIFEST_FILENAME not in manifest["files"]

    def test_excludes_symlinks(self, tmp_path: Path):
        real = tmp_path / "real.bin"
        real.write_bytes(b"data")
        link = tmp_path / "link.bin"
        link.symlink_to(real)
        manifest = build_manifest(tmp_path, model_id="test/model", revision="abc123")
        assert "real.bin" in manifest["files"]
        assert "link.bin" not in manifest["files"]

    def test_raises_on_missing_root(self, tmp_path: Path):
        with pytest.raises(ValueError, match="does not exist"):
            build_manifest(tmp_path / "missing", model_id="test/model", revision="abc123")

    def test_raises_on_empty_root(self, tmp_path: Path):
        with pytest.raises(ValueError, match="no regular files"):
            build_manifest(tmp_path, model_id="test/model", revision="abc123")

    def test_raises_on_blank_model_id(self, tmp_path: Path):
        (tmp_path / "file.bin").write_bytes(b"data")
        with pytest.raises(ValueError, match="required"):
            build_manifest(tmp_path, model_id="", revision="abc123")

    def test_raises_on_blank_revision(self, tmp_path: Path):
        (tmp_path / "file.bin").write_bytes(b"data")
        with pytest.raises(ValueError, match="required"):
            build_manifest(tmp_path, model_id="test/model", revision="  ")


class TestWriteManifest:
    def test_writes_manifest_and_returns_sha256(self, tmp_path: Path):
        (tmp_path / "weights.safetensors").write_bytes(b"model weights")
        sha256 = write_manifest(tmp_path, model_id="test/model", revision="abc123")
        assert len(sha256) == 64
        manifest_path = tmp_path / MANIFEST_FILENAME
        assert manifest_path.is_file()
        # Verify the returned SHA-256 matches the actual file
        actual = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        assert sha256 == actual

    def test_manifest_is_deterministic(self, tmp_path: Path):
        (tmp_path / "a.bin").write_bytes(b"aaa")
        (tmp_path / "b.bin").write_bytes(b"bbb")
        sha1 = write_manifest(tmp_path, model_id="test/model", revision="abc123")
        sha2 = write_manifest(tmp_path, model_id="test/model", revision="abc123")
        assert sha1 == sha2


# ---------------------------------------------------------------------------
# Download service — status and existing bundle detection
# ---------------------------------------------------------------------------


class TestDownloadServiceStatus:
    def test_idle_when_no_model_present(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)
        status = service.status()
        assert status.status == DownloadStatus.IDLE
        assert status.bundle_sha256 is None

    def test_ready_when_existing_bundle_present(self, tmp_path: Path):
        # Create a valid pinned bundle.
        (tmp_path / "weights.safetensors").write_bytes(b"model weights")
        write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)

        service = CaptionModelDownloadService(tmp_path)
        status = service.status()
        assert status.status == DownloadStatus.READY
        assert status.bundle_sha256 is not None
        assert len(status.bundle_sha256) == 64

    def test_idle_when_existing_bundle_file_hash_is_invalid(self, tmp_path: Path):
        model = tmp_path / "weights.safetensors"
        model.write_bytes(b"expected model weights")
        write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)
        model.write_bytes(b"modified model weights")

        service = CaptionModelDownloadService(tmp_path)
        assert service.status().status == DownloadStatus.IDLE

    def test_idle_when_manifest_is_invalid(self, tmp_path: Path):
        (tmp_path / MANIFEST_FILENAME).write_text("not json")
        service = CaptionModelDownloadService(tmp_path)
        assert service.status().status == DownloadStatus.IDLE

    def test_idle_when_manifest_references_missing_files(self, tmp_path: Path):
        manifest = {"files": {"missing.bin": "a" * 64}}
        (tmp_path / MANIFEST_FILENAME).write_text(json.dumps(manifest))
        service = CaptionModelDownloadService(tmp_path)
        assert service.status().status == DownloadStatus.IDLE

    def test_idle_when_manifest_has_empty_files(self, tmp_path: Path):
        manifest = {"files": {}}
        (tmp_path / MANIFEST_FILENAME).write_text(json.dumps(manifest))
        service = CaptionModelDownloadService(tmp_path)
        assert service.status().status == DownloadStatus.IDLE


# ---------------------------------------------------------------------------
# Download service — download lifecycle
# ---------------------------------------------------------------------------


def _fake_snapshot_download(model_root: Path):
    """Simulate a successful snapshot_download by writing fixture files."""

    def fake(model_id, *, revision, local_dir, **kwargs):
        root = Path(local_dir)
        root.mkdir(parents=True, exist_ok=True)
        (root / "config.json").write_text('{"model_type": "smolvlm"}')
        (root / "model.safetensors").write_bytes(b"fake model weights")
        (root / "tokenizer.json").write_text('{"tokens": []}')
        return str(root)

    return fake


class TestDownloadLifecycle:
    @pytest.mark.asyncio
    async def test_download_transitions_to_ready(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)
        assert service.status().status == DownloadStatus.IDLE

        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:
            # Simulate the download writing files + manifest
            def do_download():
                (tmp_path / "config.json").write_text('{"model_type": "smolvlm"}')
                (tmp_path / "model.safetensors").write_bytes(b"fake weights")
                return write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)

            mock.side_effect = lambda: do_download()

            status = await service.start_download()
            assert status.status == DownloadStatus.DOWNLOADING

            # Wait for the background task to complete
            if service._state.task:
                await service._state.task

        final = service.status()
        assert final.status == DownloadStatus.READY
        assert final.bundle_sha256 is not None

    @pytest.mark.asyncio
    async def test_download_failure_transitions_to_failed(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)

        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:
            mock.side_effect = RuntimeError("Network error")

            await service.start_download()

            # Wait for the background task
            if service._state.task:
                with pytest.raises(RuntimeError):
                    await service._state.task

        final = service.status()
        assert final.status == DownloadStatus.FAILED
        assert "Network error" in (final.error or "")

    @pytest.mark.asyncio
    async def test_retry_after_failure(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)

        # First attempt fails
        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:
            mock.side_effect = RuntimeError("First failure")
            await service.start_download()
            if service._state.task:
                with pytest.raises(RuntimeError):
                    await service._state.task

        assert service.status().status == DownloadStatus.FAILED

        # Second attempt succeeds
        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:

            def do_download():
                (tmp_path / "model.safetensors").write_bytes(b"weights")
                return write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)

            mock.side_effect = lambda: do_download()

            await service.start_download()
            if service._state.task:
                await service._state.task

        assert service.status().status == DownloadStatus.READY

    @pytest.mark.asyncio
    async def test_concurrent_download_rejected(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)

        # Use an event to keep the download running
        hold = asyncio.Event()

        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:

            async def slow_download():
                await hold.wait()
                (tmp_path / "model.safetensors").write_bytes(b"weights")
                return write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)

            # Override _run_download to use async blocking

            async def blocking_run():
                await hold.wait()
                (tmp_path / "model.safetensors").write_bytes(b"weights")
                sha = write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)
                service._state.status = DownloadStatus.READY
                service._state.bundle_sha256 = sha
                return sha

            mock.side_effect = lambda: None  # Won't be called
            service._run_download = blocking_run  # type: ignore[assignment]

            await service.start_download()

            with pytest.raises(RuntimeError, match="already in progress"):
                await service.start_download()

            hold.set()
            if service._state.task:
                await service._state.task

    @pytest.mark.asyncio
    async def test_skip_download_when_already_ready(self, tmp_path: Path):
        # Pre-provision a pinned bundle.
        (tmp_path / "model.safetensors").write_bytes(b"weights")
        write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)

        service = CaptionModelDownloadService(tmp_path)
        assert service.status().status == DownloadStatus.READY

        # start_download should return ready immediately without starting a task
        status = await service.start_download()
        assert status.status == DownloadStatus.READY
        assert service._state.task is None


# ---------------------------------------------------------------------------
# Download service — cancellation
# ---------------------------------------------------------------------------


class TestDownloadCancellation:
    @pytest.mark.asyncio
    async def test_cancel_active_download(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)
        hold = asyncio.Event()

        async def blocking_run():
            await hold.wait()
            return "never"

        service._run_download = blocking_run  # type: ignore[assignment]

        await service.start_download()
        assert service.status().status == DownloadStatus.DOWNLOADING

        status = await service.cancel_download()
        assert status.status == DownloadStatus.IDLE
        assert status.error is None

    @pytest.mark.asyncio
    async def test_cancel_when_idle_is_noop(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)
        status = await service.cancel_download()
        assert status.status == DownloadStatus.IDLE


# ---------------------------------------------------------------------------
# Download service — callback
# ---------------------------------------------------------------------------


class TestBundleReadyCallback:
    @pytest.mark.asyncio
    async def test_callback_invoked_on_success(self, tmp_path: Path):
        callback = AsyncMock()
        service = CaptionModelDownloadService(tmp_path, on_bundle_ready=callback)

        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:

            def do_download():
                (tmp_path / "model.safetensors").write_bytes(b"weights")
                return write_manifest(tmp_path, model_id=PINNED_MODEL_ID, revision=PINNED_REVISION)

            mock.side_effect = lambda: do_download()

            await service.start_download()
            if service._state.task:
                await service._state.task

        callback.assert_awaited_once()
        sha = callback.call_args[0][0]
        assert len(sha) == 64

    @pytest.mark.asyncio
    async def test_callback_not_invoked_on_failure(self, tmp_path: Path):
        callback = AsyncMock()
        service = CaptionModelDownloadService(tmp_path, on_bundle_ready=callback)

        with patch(
            "asterism.domains.knowledge.caption_download.CaptionModelDownloadService._download_sync",
        ) as mock:
            mock.side_effect = RuntimeError("fail")
            await service.start_download()
            if service._state.task:
                with pytest.raises(RuntimeError):
                    await service._state.task

        callback.assert_not_awaited()


# ---------------------------------------------------------------------------
# Download service — shutdown
# ---------------------------------------------------------------------------


class TestDownloadShutdown:
    @pytest.mark.asyncio
    async def test_shutdown_cancels_active_download(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)
        hold = asyncio.Event()

        async def blocking_run():
            await hold.wait()
            return "never"

        service._run_download = blocking_run  # type: ignore[assignment]
        await service.start_download()

        await service.shutdown()
        assert service.status().status == DownloadStatus.IDLE

    @pytest.mark.asyncio
    async def test_shutdown_when_idle_is_safe(self, tmp_path: Path):
        service = CaptionModelDownloadService(tmp_path)
        await service.shutdown()
        assert service.status().status == DownloadStatus.IDLE


# ---------------------------------------------------------------------------
# Router endpoints
# ---------------------------------------------------------------------------


class TestCaptionModelEndpoints:
    @pytest.fixture
    def admin_user(self):
        from asterism.core.schemas import AuthedUser

        return AuthedUser(id="admin-1", email="admin@example.com", name="Admin", role="admin")

    @pytest.mark.asyncio
    async def test_get_status_endpoint(self, admin_user):
        from asterism.domains.knowledge.captioning import CaptionModelStatus
        from asterism.domains.settings.settings_router import get_caption_model_status

        with patch("asterism.domains.knowledge.runtime.caption_model_download") as mock_service:
            mock_service.status.return_value = CaptionModelStatus(status=DownloadStatus.IDLE)
            result = await get_caption_model_status(user=admin_user)
            assert result.status == DownloadStatus.IDLE

    @pytest.mark.asyncio
    async def test_start_download_endpoint(self, admin_user):
        from asterism.domains.knowledge.captioning import CaptionModelStatus
        from asterism.domains.settings.settings_router import start_caption_model_download

        with patch("asterism.domains.knowledge.runtime.caption_model_download") as mock_service:
            mock_service.start_download = AsyncMock(return_value=CaptionModelStatus(status=DownloadStatus.DOWNLOADING))
            result = await start_caption_model_download(user=admin_user)
            assert result.status == DownloadStatus.DOWNLOADING

    @pytest.mark.asyncio
    async def test_start_download_endpoint_conflict(self, admin_user):
        from asterism.domains.settings.settings_router import start_caption_model_download
        from fastapi import HTTPException

        with patch("asterism.domains.knowledge.runtime.caption_model_download") as mock_service:
            mock_service.start_download = AsyncMock(side_effect=RuntimeError("A download is already in progress"))
            with pytest.raises(HTTPException) as exc:
                await start_caption_model_download(user=admin_user)
            assert exc.value.status_code == 409
            assert "already in progress" in str(exc.value.detail)

    @pytest.mark.asyncio
    async def test_cancel_download_endpoint(self, admin_user):
        from asterism.domains.knowledge.captioning import CaptionModelStatus
        from asterism.domains.settings.settings_router import cancel_caption_model_download

        with patch("asterism.domains.knowledge.runtime.caption_model_download") as mock_service:
            mock_service.cancel_download = AsyncMock(return_value=CaptionModelStatus(status=DownloadStatus.IDLE))
            result = await cancel_caption_model_download(user=admin_user)
            assert result.status == DownloadStatus.IDLE
