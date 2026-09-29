"""Streaming hash helpers for filesystem-backed artifacts."""

import hashlib
from collections.abc import Callable
from pathlib import Path

SHA256_BLOCK_SIZE = 1024 * 1024


def sha256_file(path: Path) -> str:
    """Return a SHA-256 digest without loading the complete file into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(SHA256_BLOCK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(
    path: Path,
    expected_sha256: str,
    expected_size_bytes: int,
    error_provider: Callable[[str], RuntimeError] | None = None,
) -> None:
    """Verify that a file matches the expected SHA-256 digest and size."""
    if not path.is_file():
        if error_provider:
            raise error_provider(f"File not found: {path}")
        raise FileNotFoundError(f"File not found: {path}")
    actual_size_bytes = path.stat().st_size
    if actual_size_bytes != expected_size_bytes:
        if error_provider:
            raise error_provider(
                f"File size mismatch for {path}: expected {expected_size_bytes} bytes, got {actual_size_bytes} bytes"
            )
        raise ValueError(
            f"File size mismatch for {path}: expected {expected_size_bytes} bytes, got {actual_size_bytes} bytes"
        )
    actual_sha256 = sha256_file(path)
    if actual_sha256.lower() != expected_sha256.lower():
        if error_provider:
            raise error_provider(f"SHA-256 mismatch for {path}: expected {expected_sha256}, got {actual_sha256}")
        raise ValueError(f"SHA-256 mismatch for {path}: expected {expected_sha256}, got {actual_sha256}")
