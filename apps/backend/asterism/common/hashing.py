"""Streaming hash helpers for filesystem-backed artifacts."""

import hashlib
from pathlib import Path

SHA256_BLOCK_SIZE = 1024 * 1024


def sha256_file(path: Path) -> str:
    """Return a SHA-256 digest without loading the complete file into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(SHA256_BLOCK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()
