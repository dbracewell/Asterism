import uuid

import pytest
from asterism.domains.files.store import LocalFileStore


@pytest.mark.asyncio
async def test_shards_owner_isolation_original_bytes_and_exclusive_writes(tmp_path):
    store = LocalFileStore(tmp_path)
    file_id = uuid.UUID("aabbccdd-1111-2222-3333-444444444444")
    content = bytes(range(256))
    key = store.save("user-a", file_id, ".PDF", content)
    assert key == f"user-a/aa/bb/{file_id}/source.pdf"
    assert store.local_path("user-a", key) == tmp_path / key
    assert await store.read_bytes("user-a", key) == content
    assert await store.exists("user-a", key)
    with pytest.raises(FileExistsError):
        store.save("user-a", file_id, ".pdf", b"overwrite")
    assert await store.read_bytes("user-a", key) == content
    with pytest.raises(ValueError):
        await store.read_bytes("user-b", key)
    other = store.save("user-b", file_id, ".pdf", b"other")
    store.delete("user-a", key)
    store.delete("user-a", key)
    assert not await store.exists("user-a", key)
    with pytest.raises(FileNotFoundError):
        await store.read_bytes("user-a", key)
    assert await store.read_bytes("user-b", other) == b"other"


@pytest.mark.asyncio
async def test_read_bytes_stops_at_limit(tmp_path):
    store = LocalFileStore(tmp_path)
    key = store.save("user-a", uuid.uuid4(), ".bin", b"0123456789")
    assert await store.read_bytes("user-a", key, limit=4) == b"0123"
    assert await store.read_bytes("user-a", key, limit=100) == b"0123456789"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "key",
    [
        "../secret",
        "a/aa/bb/not-uuid/source.txt",
        "a/00/00/aabbccdd-1111-2222-3333-444444444444/source.txt",
        "a/aa/bb/aabbccdd-1111-2222-3333-444444444444/../../secret",
    ],
)
async def test_malformed_keys_are_rejected(tmp_path, key):
    store = LocalFileStore(tmp_path)
    with pytest.raises(ValueError):
        await store.read_bytes("a", key)
    with pytest.raises(ValueError):
        await store.exists("a", key)
    with pytest.raises(ValueError):
        store.local_path("a", key)
    with pytest.raises(ValueError):
        store.delete("a", key)


@pytest.mark.asyncio
async def test_opaque_owner_encoding_and_symlink_escape(tmp_path):
    store = LocalFileStore(tmp_path / "files")
    key = store.save("../a/b", uuid.uuid4(), ".txt", b"safe")
    assert key.startswith("..%2Fa%2Fb/")
    assert await store.read_bytes("../a/b", key) == b"safe"
    (tmp_path / "outside").mkdir()
    (store.root / "evil").symlink_to(tmp_path / "outside", target_is_directory=True)
    with pytest.raises(ValueError):
        store.save("evil", uuid.uuid4(), ".txt", b"escape")
