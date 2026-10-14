import uuid

import pytest
from asterism.domains.files.store import LocalFileStore


def test_shards_owner_isolation_original_bytes_and_exclusive_writes(tmp_path):
    store = LocalFileStore(tmp_path)
    file_id = uuid.UUID("aabbccdd-1111-2222-3333-444444444444")
    content = bytes(range(256))
    key = store.save("user-a", file_id, ".PDF", content)
    assert key == f"user-a/aa/bb/{file_id}/source.pdf"
    assert store.open("user-a", key) == tmp_path / key
    assert store.open("user-a", key).read_bytes() == content
    with pytest.raises(FileExistsError):
        store.save("user-a", file_id, ".pdf", b"overwrite")
    assert store.open("user-a", key).read_bytes() == content
    with pytest.raises(ValueError):
        store.open("user-b", key)
    other = store.save("user-b", file_id, ".pdf", b"other")
    store.delete("user-a", key)
    store.delete("user-a", key)
    assert not store.open("user-a", key).exists()
    assert store.open("user-b", other).read_bytes() == b"other"


@pytest.mark.parametrize(
    "key",
    [
        "../secret",
        "a/aa/bb/not-uuid/source.txt",
        "a/00/00/aabbccdd-1111-2222-3333-444444444444/source.txt",
        "a/aa/bb/aabbccdd-1111-2222-3333-444444444444/../../secret",
    ],
)
def test_malformed_keys_are_rejected(tmp_path, key):
    store = LocalFileStore(tmp_path)
    with pytest.raises(ValueError):
        store.open("a", key)
    with pytest.raises(ValueError):
        store.delete("a", key)


def test_opaque_owner_encoding_and_symlink_escape(tmp_path):
    store = LocalFileStore(tmp_path / "files")
    key = store.save("../a/b", uuid.uuid4(), ".txt", b"safe")
    assert key.startswith("..%2Fa%2Fb/")
    assert store.open("../a/b", key).read_bytes() == b"safe"
    (tmp_path / "outside").mkdir()
    (store.root / "evil").symlink_to(tmp_path / "outside", target_is_directory=True)
    with pytest.raises(ValueError):
        store.save("evil", uuid.uuid4(), ".txt", b"escape")
