"""Hugging Face local-dir download locks after the filelock 4 upgrade (US-95.3).

Model downloads call ``snapshot_download(local_dir=...)``. huggingface-hub keeps
per-file download metadata under ``<local_dir>/.cache/huggingface/download``
and guards each file with ``WeakFileLock``, a ``filelock.FileLock`` wrapper.
These tests use those real functions, with no network, from several threads,
the way two downloads at once would.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from huggingface_hub._local_folder import (
    get_local_download_paths,
    read_download_metadata,
    write_download_metadata,
)
from huggingface_hub.utils import WeakFileLock


def test_a_download_lock_waits_for_the_holder(tmp_path: Path) -> None:
    lock_path = get_local_download_paths(tmp_path, "model.onnx").lock_path
    held = threading.Event()
    order: list[str] = []

    def first() -> None:
        with WeakFileLock(lock_path):
            order.append("first acquired")
            held.set()
            time.sleep(0.3)
            order.append("first released")

    def second() -> None:
        held.wait(5)
        with WeakFileLock(lock_path, timeout=5):
            order.append("second acquired")

    with ThreadPoolExecutor(2) as pool:
        for future in [pool.submit(first), pool.submit(second)]:
            future.result(timeout=10)

    assert order == ["first acquired", "first released", "second acquired"]
    assert lock_path.parent == tmp_path / ".cache" / "huggingface" / "download"


def test_two_downloads_at_once_keep_their_metadata_intact(tmp_path: Path) -> None:
    models = [tmp_path / "embedding", tmp_path / "caption"]
    filenames = ["model.onnx", "config.json"]
    rounds = 20

    def download(local_dir: Path, filename: str, worker: int) -> None:
        for index in range(rounds):
            write_download_metadata(local_dir, filename, f"commit-{worker}-{index}", f"etag-{worker}-{index}")
            metadata = read_download_metadata(local_dir, filename)
            # A read never sees a half-written file, which would come back as
            # None after huggingface-hub deleted it as corrupt.
            assert metadata is not None
            assert metadata.commit_hash.startswith("commit-")
            assert metadata.etag.replace("etag", "commit") == metadata.commit_hash

    for local_dir in models:
        for filename in filenames:
            # Metadata only counts for a file that has been downloaded.
            (local_dir / filename).parent.mkdir(parents=True, exist_ok=True)
            (local_dir / filename).write_bytes(b"weights")

    jobs = [(local_dir, filename, worker) for local_dir in models for filename in filenames for worker in range(2)]
    with ThreadPoolExecutor(len(jobs)) as pool:
        for future in [pool.submit(download, *job) for job in jobs]:
            future.result(timeout=30)

    for local_dir in models:
        for filename in filenames:
            metadata = read_download_metadata(local_dir, filename)
            assert metadata is not None and metadata.filename == filename
