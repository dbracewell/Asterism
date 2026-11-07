"""Starter packs shipped with the server (US-59.4).

Each is an ordinary pack file, read at import and validated by ``parse_pack``, so
a malformed one fails startup and tests. Clients send a starter's ``source``
through the same review and import as any other pack, so it gets no extra trust.
"""

from pathlib import Path

from .documents import parse_pack
from .schemas import StarterPack, StarterPackCatalog

_DIRECTORY = Path(__file__).parent / "bundled"
# Display order. A test keeps this in step with the files on disk.
STARTER_PACK_IDS = ("research-critique-synthesis", "write-review-fact-check", "study-buddy")


def _load(pack_id: str) -> StarterPack:
    source = (_DIRECTORY / f"{pack_id}.team-pack.json").read_bytes()
    identity = parse_pack(source).pack
    return StarterPack(
        id=identity.id,
        version=identity.version,
        name=identity.name,
        description=identity.description,
        source=source.decode("utf-8"),
    )


STARTER_PACKS = StarterPackCatalog(items=[_load(pack_id) for pack_id in STARTER_PACK_IDS])
