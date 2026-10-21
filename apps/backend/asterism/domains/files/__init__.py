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
- ``processing``       – Knowledge-processing policy transitions and artifact
                         generations (the policy itself lives in
                         ``asterism.domains.settings.knowledge``).
- ``processing_schemas`` – Pydantic models for the processing policy/profile.
- ``service``          – Use-case orchestration (upload, list, delete, …).
- ``router``           – FastAPI transport layer.
- ``runtime_access``   – Model-facing reads, gated by live execution scope.

Ownership invariant: every persisted source belongs to exactly one user, and
every read is scoped by ``user_id`` at the query boundary. Runtime access adds
a second, live authorization layer on top of plain ownership.
"""
