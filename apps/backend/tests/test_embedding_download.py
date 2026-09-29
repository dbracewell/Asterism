import asyncio
import hashlib
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from asterism.core import config
from asterism.domains.knowledge.embedding_download import (
    MANIFEST_FILENAME,
    PINNED_MODEL_ID,
    PINNED_REVISION,
    REQUIRED_FILES,
    EmbeddingModelDownloadService,
)


def _write_verified_bundle(root: Path, model: bytes = b"reviewed-onnx") -> str:
    root.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_FILES:
        (root / name).write_bytes(model if name == "model.onnx" else name.encode())
    files = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in REQUIRED_FILES}
    manifest = {
        "model_id": PINNED_MODEL_ID,
        "revision": PINNED_REVISION,
        "files": files,
    }
    content = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    (root / MANIFEST_FILENAME).write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def _service(root: Path, **kwargs) -> EmbeddingModelDownloadService:
    return EmbeddingModelDownloadService(
        root,
        artifact_sha256=hashlib.sha256(b"reviewed-onnx").hexdigest(),
        artifact_size_bytes=len(b"reviewed-onnx"),
        **kwargs,
    )


def test_configured_artifact_matches_reviewed_pinned_revision():
    assert config.knowledge_embedding_model_size_bytes == 152_998_734
    assert config.knowledge_embedding_model_sha256 == "90d3b30b11fc99c781a147df7cb3b8dff38b02b2d838b3b28392e7dfb34920b9"


def test_existing_verified_embedding_bundle_is_ready(tmp_path: Path):
    expected = _write_verified_bundle(tmp_path)
    status = _service(tmp_path).status()
    assert status.status == "ready"
    assert status.bundle_sha256 == expected


def test_corrupt_embedding_bundle_is_not_ready(tmp_path: Path):
    _write_verified_bundle(tmp_path)
    (tmp_path / "model.onnx").write_bytes(b"modified")
    assert _service(tmp_path).status().status == "idle"


@pytest.mark.asyncio
async def test_download_success_promotes_then_resumes_pending_work(tmp_path: Path):
    ready = AsyncMock()
    service = _service(tmp_path, on_bundle_ready=ready)

    def write_stage(*_) -> str:
        return _write_verified_bundle(tmp_path)

    with patch.object(service, "_download_sync", side_effect=write_stage):
        assert (await service.start_download()).status == "downloading"
        while service.status().status == "downloading":
            await asyncio.sleep(0)
    assert service.status().status == "ready"
    ready.assert_awaited_once()


@pytest.mark.asyncio
async def test_download_failure_is_safe_and_retryable(tmp_path: Path):
    service = _service(tmp_path)
    with patch.object(service, "_download_sync", side_effect=OSError("offline")):
        await service.start_download()
        while service.status().status == "downloading":
            await asyncio.sleep(0)
    assert service.status().status == "failed"
    assert service.status().error == "Embedding bundle download failed; check server logs"


@pytest.mark.asyncio
async def test_only_one_download_is_active_and_cancellation_resets_state(tmp_path: Path):
    service = _service(tmp_path)
    started = asyncio.Event()

    async def blocked_download() -> str:
        started.set()
        await asyncio.Event().wait()

    with patch.object(service, "_run_download", side_effect=blocked_download):
        assert (await service.start_download()).status == "downloading"
        await started.wait()
        assert (await service.start_download()).status == "downloading"
        assert service._state.task is not None
        await service.cancel_download()

    assert service.status().status == "idle"


def test_bundle_rejects_symlinked_required_file(tmp_path: Path):
    _write_verified_bundle(tmp_path)
    external = tmp_path.parent / "untrusted-model.onnx"
    external.write_bytes(b"reviewed-onnx")
    (tmp_path / "model.onnx").unlink()
    (tmp_path / "model.onnx").symlink_to(external)
    assert _service(tmp_path).status().status == "idle"


def test_missing_promoted_root_recovers_previous_verified_bundle(tmp_path: Path):
    previous = tmp_path / "knowledge-clip.previous"
    expected = _write_verified_bundle(previous)
    status = _service(tmp_path / "knowledge-clip").status()
    assert status.status == "ready"
    assert status.bundle_sha256 == expected
