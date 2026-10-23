# Completed checklist — 2026-10-23

Epic 38 is confirmed complete. US-38.1 through US-38.4 were previously merged
into local `main`; the user confirmed US-38.5 on 2026-10-23, authorizing its
commit and local merge from `feat/us-38.5-caption-contract-docs`.

## [EPIC-38: Knowledge pipeline structure](../epics/EPIC-38-KNOWLEDGE-PIPELINE-STRUCTURE.md)

- [x] US-38.1: Name the knowledge domain for what it holds
  - [x] Rename `domains/extraction` to `domains/knowledge`, the artifact model to `FileKnowledgeArtifactModel` and the table to `file_knowledge_artifacts`.
  - [x] Update all backend, test and documentation references, including the frontend's generated client types.
  - [x] Re-check the vocabulary: no "extraction" may remain as a domain, package, table or model name.
  - [x] Record ADR-0018 covering the domain boundary, the vocabulary decision and the rejected alternatives.
  - [x] Run backend lint, type checks and the full test suite; verify a fresh database initialization creates the renamed table.
- [x] US-38.2: Give the processing policy one owner
  - [x] Move the processing-policy schemas, persistence and transitions from `files` and `settings` into the knowledge domain.
  - [x] Move the knowledge admin endpoints to a knowledge router, preserving their URLs, operation ids and response shapes.
  - [x] Remove the deferred cross-domain imports that exist only to break the settings/files cycle.
  - [x] Verify the OpenAPI contract is unchanged for the moved endpoints and regenerate the client if the operation grouping changed.
  - [x] Run backend lint, type checks and the full test suite.
- [x] US-38.3: Model derived facets as first-class rows
  - [x] Add the extraction-kind enum and the linking table with a unique `(artifact_id, kind)` constraint.
  - [x] Replace the parallel artifact and caption status vocabularies with one status vocabulary for every kind.
  - [x] Move the caption's flat columns, the text content and the embedding readiness flags into per-kind rows; keep a denormalized searchable aggregate on the artifact row for the retrieval path.
  - [x] Model payloads as a discriminated union keyed by kind, validated at the application boundary.
  - [x] Replace the flat API fields with a map of extractions; regenerate the typed client and update the file manager and file view to render the per-kind statuses.
  - [x] Add retrieval, file-library and file-view regressions for the new shape.
- [x] US-38.4: Make the dependency direction explicit
  - [x] Publish a narrow artifact reader/service in the knowledge domain and route the files domain's knowledge operations through it.
  - [x] Replace the files domain's deferred imports of the artifact model, artifact queries and ingestion runtime.
  - [x] Inject the source reader into ingestion, mirroring the existing injected embedding provider, vector store and caption request hook.
  - [x] Add an import-boundary test that fails when a knowledge module imports the files domain at module level.
- [x] US-38.5: Retire the dead caption review contract and reconcile the docs
  - [x] Decide and record the disposition of the caption review lifecycle: implement it as per-extraction states, or remove it from the product and the documentation.
  - [x] Remove the never-written caption review fields and make the generation timestamp describe the extraction rather than the artifact.
  - [x] Correct the caption state names in the file-knowledge, retrieval and data-storage architecture guides.
  - [x] Run the full backend and frontend gates and the documentation checks.

Verification for US-38.5: lint, type checks, formatting, 531 backend tests,
352 frontend tests, six migration checks, and 30 configuration checks passed.
Changed documentation passed formatting and local-link checks. Browser E2E was
not rerun; earlier E2E failures are not recorded as a pass.
