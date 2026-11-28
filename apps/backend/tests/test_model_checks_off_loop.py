"""US-119.3: checking a model bundle never blocks the event loop."""

import asyncio
import threading
from pathlib import Path
from unittest.mock import patch

import pytest
from asterism.domains.knowledge import model_download
from test_embedding_download import _service, _write_verified_bundle

pytestmark = pytest.mark.asyncio


def _blocking_hash(started: threading.Event, release: threading.Event, threads: list[int]):
    real = model_download.sha256_file

    def sha256_file(path):
        threads.append(threading.get_ident())
        started.set()
        assert release.wait(5)
        return real(path)

    return sha256_file


async def test_requests_are_answered_while_a_bundle_is_verified(tmp_path: Path):
    _write_verified_bundle(tmp_path / "bundle")
    service = _service(tmp_path / "bundle")
    started, release, threads = threading.Event(), threading.Event(), []

    with patch.object(model_download, "sha256_file", _blocking_hash(started, release, threads)):
        checks = [asyncio.create_task(service.ready()), asyncio.create_task(service.current_progress())]
        assert await asyncio.to_thread(started.wait, 5)
        # The loop still runs other work while the bundle is hashed.
        await asyncio.wait_for(asyncio.sleep(0.01), 1)
        assert not any(check.done() for check in checks)
        release.set()
        ready, progress = await asyncio.gather(*checks)

    assert ready is True and progress.status == "ready"
    assert threading.get_ident() not in threads
    # Both callers shared one check: each bundle file was hashed once, plus the
    # manifest itself for the progress report's bundle digest.
    manifest = model_download.json.loads((tmp_path / "bundle" / model_download.MANIFEST_FILENAME).read_text())
    assert len(threads) == len(manifest["files"]) + 1


async def test_a_new_download_is_verified_outside_the_event_loop(tmp_path: Path):
    service = _service(tmp_path / "bundle")
    started, release, threads = threading.Event(), threading.Event(), []

    def write_stage(*_) -> str:
        return _write_verified_bundle(tmp_path / "bundle")

    with (
        patch.object(service, "_download_sync", side_effect=write_stage),
        patch.object(model_download, "sha256_file", _blocking_hash(started, release, threads)),
    ):
        await service.start_download()
        assert await asyncio.to_thread(started.wait, 5)
        await asyncio.wait_for(asyncio.sleep(0.01), 1)
        assert service.state.status == "verifying"
        release.set()
        assert service.state.task is not None
        await service.state.task

    assert service.state.status == "ready"
    assert threads and threading.get_ident() not in threads
