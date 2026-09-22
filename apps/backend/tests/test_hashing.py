import hashlib
from pathlib import Path

from asterism.common.hashing import SHA256_BLOCK_SIZE, sha256_file


def test_sha256_file_streams_and_hashes_multiple_blocks(tmp_path: Path):
    content = b"a" * SHA256_BLOCK_SIZE + b"b"
    path = tmp_path / "large.bin"
    path.write_bytes(content)

    assert sha256_file(path) == hashlib.sha256(content).hexdigest()
