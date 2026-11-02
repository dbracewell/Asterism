"""Span-citation keys for retrieved chunks (ADR-0040).

A retrieved chunk is cited in Markdown as ``[claim](asterism-cite:<key>)``. The
key is short so models copy it reliably, and derived from the file and chunk so
the same chunk always gets the same key. A key is only a lookup handle: it
resolves solely against chunks that the saving run actually retrieved.
"""

import hashlib
import uuid

CITATION_SCHEME = "asterism-cite:"
CITATION_KEY_LENGTH = 12
MAX_KEYS_PER_CITATION = 4
"""One claim may cite up to this many chunks, comma-separated."""


def citation_key(file_id: uuid.UUID, chunk_id: str) -> str:
    """Twelve lowercase hex characters identifying one chunk of one file."""
    return hashlib.sha256(f"{file_id}:{chunk_id}".encode()).hexdigest()[:CITATION_KEY_LENGTH]


def citation_token(file_id: uuid.UUID, chunk_id: str) -> str:
    """The link destination a model writes to cite this chunk."""
    return CITATION_SCHEME + citation_key(file_id, chunk_id)
