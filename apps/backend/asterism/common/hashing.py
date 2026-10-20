"""Streaming hash helpers for filesystem-backed artifacts."""

import hashlib
from collections.abc import Callable
from pathlib import Path

# Read files in 1 MiB chunks so large artifacts never sit fully in memory.
SHA256_BLOCK_SIZE = 1024 * 1024


def sha256_file(path: Path) -> str:
    """Return a SHA-256 digest without loading the complete file into memory.

    Args:
        path: Path to an existing, readable file.

    Returns:
        The lowercase hexadecimal SHA-256 digest of the file's contents.
    """
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
    """Verify that a file matches the expected SHA-256 digest and size.

    Args:
        path: Path to the file to verify.
        expected_sha256: Expected lowercase or uppercase hexadecimal SHA-256 digest; comparison is case-insensitive.
        expected_size_bytes: Expected file size in bytes.
        error_provider: Optional factory turning an error message into a domain-specific ``RuntimeError`` subclass. When omitted, plain ``FileNotFoundError``/``ValueError`` are raised instead.

    Raises:
        FileNotFoundError (or *error_provider* output): If the file does not exist.
        ValueError (or *error_provider* output): If the size or SHA-256 digest does not match.
    """  # noqa: E501
    if not path.is_file():
        if error_provider:
            raise error_provider(f"File not found: {path}")
        raise FileNotFoundError(f"File not found: {path}")
    actual_size_bytes = path.stat().st_size
    if actual_size_bytes != expected_size_bytes:
        if error_provider:
            raise error_provider(
                f"File size mismatch for {path}: expected {expected_size_bytes} bytes, got {actual_size_bytes} bytes",
            )
        raise ValueError(
            f"File size mismatch for {path}: expected {expected_size_bytes} bytes, got {actual_size_bytes} bytes",
        )
    actual_sha256 = sha256_file(path)
    if actual_sha256.lower() != expected_sha256.lower():
        if error_provider:
            raise error_provider(f"SHA-256 mismatch for {path}: expected {expected_sha256}, got {actual_sha256}")
        raise ValueError(f"SHA-256 mismatch for {path}: expected {expected_sha256}, got {actual_sha256}")
