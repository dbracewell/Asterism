"""Knowledge domain: the platform's derived, retrievable knowledge about a file.

*Knowledge* here means the derived, retrievable output the platform produces
from a source file — text extraction, embeddings, captions and their vectors.
It does not mean asserted facts, entities or relations; no knowledge graph is
implemented.

Layering (each module owns exactly one responsibility):

- ``models``           – SQLAlchemy table and enums for the persisted artifact.
- ``schemas``          – Pydantic response models returned by the HTTP API.
- ``queries``          – Composable, owner-scoped select builders.
- ``processing_schemas`` – Pydantic models for the processing policy/profile.
- ``policy``           – Processing-policy persistence and validation.
- ``processing``       – Processing-policy transitions and artifact generations.
- ``caption_schemas``  – Pydantic models for the captioning configuration.
- ``captioning``       – Caption providers and the local captioning bundle.
- ``embedding``        – Embedding providers and the local ONNX bundle.
- ``model_download``   – Model bundle download and provisioning service.
- ``vector_store``     – Vector-store adapter; the only place that writes or
                         queries embeddings.
- ``ingestion``        – Bounded, idempotent artifact generation.
- ``retention``        – Superseded-generation pruning within the retention
                         window.
- ``runtime``          – Process-local job scheduling and provider wiring.
- ``router``           – FastAPI transport for the knowledge admin surfaces.

Ownership invariant: every artifact belongs to exactly one user and one file,
and every read is scoped by ``user_id`` at the query boundary. The files domain
depends on this package; this package reaches back into the files domain for
source access, which EPIC-38 (US-38.4) resolves by injecting the source
reader into ingestion. The policy modules do not import the files domain at
all: the files a policy change reprocesses are derived from this domain's own
artifact table.
"""
