"""User file domain: uploaded sources, their derived content, and knowledge artifacts.

Layering (each module owns exactly one responsibility):

- ``models``           – SQLAlchemy tables and enums for persisted file metadata.
- ``schemas``          – Pydantic response models returned by the HTTP API.
- ``store``            – Filesystem/object-store adapter; the only place that
                         resolves a ``storage_key`` to a real path.
- ``queries``          – Composable, owner-scoped select builders.
- ``listing``          – Executes a composed query and enriches only the
                         returned page with project/knowledge summaries.
- ``processor``        – Converts a stored source into cached plain text.
- ``service``          – Use-case orchestration (upload, list, delete, …).
- ``router``           – FastAPI transport layer.
- ``runtime_access``   – Model-facing reads, gated by live execution scope.

The knowledge-processing policy — its schema, persistence, and transitions —
belongs to the knowledge domain (``asterism.domains.knowledge``), not to this
one. This domain creates a file's first knowledge artifact through the
knowledge domain's published entry point.

Ownership invariant: every persisted source belongs to exactly one user, and
every read is scoped by ``user_id`` at the query boundary. Runtime access adds
a second, live authorization layer on top of plain ownership.
"""
