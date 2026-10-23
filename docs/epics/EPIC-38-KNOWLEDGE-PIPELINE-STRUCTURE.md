# EPIC-38: Knowledge pipeline structure

Status: confirmed complete (2026-10-23). US-38.1 through US-38.5 are confirmed
complete and merged into local `main`. The completed
checklist is [archived](../archive/todo-completed-2026-10-23.md).
Source: the files-domain review of 2026-10-21 and
the follow-up architecture discussion on the knowledge pipeline's domain
ownership, naming, and data model. The naming and boundary decisions are
recorded in [ADR-0018](../adr/0018-knowledge-domain-naming-and-boundary.md).

## Objective

Give the knowledge pipeline one owner, one vocabulary, and a data model that
expresses what the runtime already does.

Three problems shape this epic:

1. **The pipeline is split across three domains.** `files/processing.py` owns
   the processing-policy transition, `settings/knowledge.py` owns the policy's
   persistence, and `domains/extraction/` owns the artifacts, ingestion,
   embeddings, captioning and vectors. `settings` imports `files` and `files`
   imports `settings`, so the cycle is closed by deferring imports and by
   reaching into another module's private functions.
2. **The domain is named for one of its facets.** The package is `extraction`
   and the table is `file_extractions`, but the artifact holds a text
   extraction, an embedding projection _and_ a generated caption. Meanwhile the
   product, the configuration keys, the admin UI and the documentation already
   call the whole thing "knowledge".
3. **The storage cannot express the runtime.** The artifact row carries seven
   `caption_*` columns plus two overloaded embedding booleans, because there
   is no way to say "one derived output of this file, with its own status".

## Vocabulary decision

**The domain is `knowledge`. `extraction` becomes the word for a single
derived output (a facet).**

The measured cost is asymmetric, and that decides it:

| Word         | Repo-wide occurrences                                  | What the rename would cost                                      |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| `knowledge`  | ~1200 (366 backend, 350 frontend, 321 docs, 165 tests) | Renaming this is the 1200-change job                            |
| `extraction` | ~475 (208 backend, 7 frontend, 115 docs, 145 tests)    | Renaming this is ~95 import sites + ~130 model/table references |

The existing ~1200 `knowledge` references are already _correct_ — they name the
config keys (`knowledge.processing`, `KNOWLEDGE_*`), the admin surface, the
storage root and the retrieval hits. The **domain** was the outlier. Renaming
`domains/extraction` → `domains/knowledge` therefore makes every existing
reference consistent, at roughly a tenth of the cost of the alternative.

"Knowledge" here means _the platform's derived, retrievable knowledge about a
file_ — not asserted facts, entities or relations. The domain documentation
states this explicitly so the name is not read as promising a knowledge graph.

Rejected alternatives, and why:

- **`common/`.** `asterism/common/` is a strict leaf layer: not one of its
  modules imports anything from `asterism.*`. The knowledge pipeline owns ORM
  models, routers, storage adapters, providers and business rules, and already
  depends on `db`, `core` and other domains. Moving it into `common` would
  make `common` a non-leaf and would not remove a single cycle.
- **`file_processing` / `processing`.** Generic, and it names the _operation_
  rather than the durable result. "Processing kind" for a caption is a
  category error: a caption is an output, not a step.
- **`derivation` / `analysis`.** More precise than "knowledge" and less
  readable, for a larger rename with no user-visible gain.

## Target boundaries

```text
files        source files: bytes, metadata, converted text, the library API
   │  (files depends on knowledge; knowledge does not depend on files)
   ▼
knowledge    artifacts, extractions, ingestion, embedding, captioning,
             vectors, and the whole processing policy
   │
   ▼
settings     providers, models, generic application settings
```

`knowledge` owns the processing policy end to end — its schema, its
persistence and its transitions — so no other domain has to import it. The
knowledge admin endpoints move to a knowledge router so `settings` no longer
imports `knowledge` either. The dependency direction becomes one-way.

## Ownership and delivery

Implementation stays within the owning domains. Schema changes use fresh
initialization; there are no migrations, compatibility shims or
live-database resets. API contract changes regenerate the typed client and land
with their frontend update in the same story. Work on one story at a time,
create its feature branch, complete the relevant gates, document the behavior
and obtain user confirmation before merge.

## US-38.1: Name the knowledge domain for what it holds

As a maintainer, I want the package, table and type names to describe the
subsystem rather than one of its facets, so that new work lands in the right
place.

Estimate: 1 day. Dependencies: None.

Acceptance criteria:

The `domains/extraction` package becomes `domains/knowledge`; the artifact
model, its table and its API type are renamed to match; every import site,
model reference and documentation reference follows. The word "extraction"
survives only where it means a single derived output of a source file. The
naming and boundary decision is recorded in an ADR.

Tasks:

- [x] Rename `domains/extraction` to `domains/knowledge`, the artifact model to
      `FileKnowledgeArtifactModel` and the table to `file_knowledge_artifacts`.
- [x] Update all backend, test and documentation references, including the
      frontend's generated client types.
- [x] Re-check the vocabulary: no "extraction" may remain as a domain, package,
      table or model name.
- [x] Record ADR-0018 covering the domain boundary, the vocabulary decision
      and the rejected alternatives.
- [x] Run backend lint, type checks and the full test suite; verify a fresh
      database initialization creates the renamed table.

## US-38.2: Give the processing policy one owner

As a maintainer, I want the processing policy to live in one domain so that
no cross-domain private imports or deferred-import cycles are needed.

Estimate: 1 day. Dependencies: US-38.1.

Acceptance criteria:

The policy's schema, persistence and transitions all live in the knowledge
domain. The knowledge admin endpoints are served by a knowledge router at
their existing URLs, so `settings` no longer imports `knowledge`, and
`knowledge` no longer imports `files`. The OpenAPI paths and operation ids
are unchanged.

Tasks:

- [x] Move the processing-policy schemas, persistence and transitions from
      `files` and `settings` into the knowledge domain.
- [x] Move the knowledge admin endpoints to a knowledge router, preserving
      their URLs, operation ids and response shapes.
- [x] Remove the deferred cross-domain imports that exist only to break the
      settings/files cycle.
- [x] Verify the OpenAPI contract is unchanged for the moved endpoints and
      regenerate the client if the operation grouping changed.
- [x] Run backend lint, type checks and the full test suite.

Notes: the policy moved as three modules — `knowledge/processing_schemas.py`,
`knowledge/policy.py`, and `knowledge/processing.py` — and the admin endpoints
are served by `knowledge/router.py`. Two crossings needed a published
interface rather than an import. The settings domain owns the
captioning-selection guard it needs (`settings/captioning_guard.py`) and the
knowledge domain registers the implementation, so neither domain imports the
other. The knowledge domain derives the files a policy change reprocesses from
its own artifact table, so the policy modules never import the files domain.
The OpenAPI tag stays `settings` because it names the public URL resource
group; only the order of the paths in the document changes, so the generated
client's content is unchanged.

## US-38.3: Model derived facets as first-class rows

As a user, I want each derived output of a file to have its own status and
its own provider, so that adding an output does not reshape the whole
artifact.

Estimate: 2–3 days including the frontend. Dependencies: US-38.1,
US-38.2.

Acceptance criteria:

A closed `KnowledgeExtractionKind` enum names the derived outputs of a source
file — text extraction, embedding and captioning — and each artifact has one
row per kind with its own status, provider, model, safe errors and payload.
One status vocabulary covers every kind. The retrieval-facing aggregate stays
denormalized on the artifact row so the retrieval hot path remains a
single-row read. Payloads are typed per kind at the application boundary. The
API reports a map of extractions instead of the flat caption columns and the
overloaded embedding booleans.

Tasks:

- [x] Add the extraction-kind enum and the linking table with a unique
      `(artifact_id, kind)` constraint.
- [x] Replace the parallel artifact and caption status vocabularies with one
      status vocabulary for every kind.
- [x] Move the caption's flat columns, the text content and the embedding
      readiness flags into per-kind rows; keep a denormalized searchable
      aggregate on the artifact row for the retrieval path.
- [x] Model payloads as a discriminated union keyed by kind, validated at the
      application boundary.
- [x] Replace the flat API fields with a map of extractions; regenerate the
      typed client and update the file manager and file view to render the
      per-kind statuses.
- [x] Add retrieval, file-library and file-view regressions for the new shape.

Notes: the derived outputs live in `file_knowledge_extractions`, one row per
`(artifact_id, kind)`, and the artifact keeps the denormalized `searchable`
aggregate the retrieval path reads. `KnowledgeExtractionStatus` is the single
vocabulary: `pending | running | ready | failed | canceled`, where `running`
replaces the artifact's `processing` and the caption's `running`. The API
reports `extractions` as a map keyed by kind whose values are a union
discriminated by `kind`, so adding an output does not change the artifact's
schema. The typed client is regenerated; the file manager and file view read
each output's status and payload.

## US-38.4: Make the dependency direction explicit

As a maintainer, I want cross-domain reads to go through a narrow published
API so that the dependency direction is visible in the code.

Estimate: 1–2 days. Dependencies: US-38.3.

Acceptance criteria:

The knowledge domain publishes one reader/service for file artifacts, and the
files domain consumes it instead of reaching into the artifact model, the
queries and the ingestion runtime. Ingestion receives the source it reads as
an injected collaborator instead of importing the files domain, so no module
under `knowledge` imports `files` at module level.

Tasks:

- [x] Publish a narrow artifact reader/service in the knowledge domain and
      route the files domain's knowledge operations through it.
- [x] Replace the files domain's deferred imports of the artifact model,
      artifact queries and ingestion runtime.
- [x] Inject the source reader into ingestion, mirroring the existing
      injected embedding provider, vector store and caption request hook.
- [x] Add an import-boundary test that fails when a knowledge module imports
      the files domain at module level.

Notes: the knowledge domain publishes `knowledge/artifacts.py`, the one service
the files domain uses for a file's knowledge: it creates the first artifact,
reports the representative generation, resets and cancels processing, removes
artifacts, and ranks similar files. The files domain's deferred imports of the
artifact model, the artifact queries, and the ingestion runtime are gone. The
knowledge domain reads its sources through the narrow contract in
`knowledge/sources.py`; the files domain provides the implementation
(`files/sources.py`), and the application installs it at startup. Two
import-boundary tests enforce the direction: no knowledge module imports the
files domain, and the files domain reaches into neither the artifact model, the
artifact queries, nor the ingestion runtime.

## US-38.5: Retire the dead caption review contract and reconcile the docs

As a user, I want the documented behavior to match the implemented behavior,
so that the documentation never promises a review workflow that does not
exist.

Estimate: 0.5 day. Dependencies: US-38.3.

Acceptance criteria:

The documentation no longer describes caption states that do not exist. The
caption's dead `accepted_at` and mis-aliased `generated_at` fields are
removed or made truthful. The architecture guides describe the final
ownership, vocabulary and extraction model.

Tasks:

- [x] Decide and record the disposition of the caption review lifecycle:
      implement it as per-extraction states, or remove it from the product
      and the documentation.
- [x] Remove the never-written caption review fields and make the generation
      timestamp describe the extraction rather than the artifact.
- [x] Correct the caption state names in the file-knowledge, retrieval and
      data-storage architecture guides.
- [x] Run the full backend and frontend gates and the documentation checks.

Disposition (US-38.5): retire the unused caption review lifecycle. Captions use
the shared extraction processing states and are indexed on successful generation;
there is no review gate or caption edit/clear action. US-38.3 already removed
`accepted_at` and `generated_at`; the API reports the captioning extraction's own
`started_at` and `completed_at`, independently of artifact ingestion timestamps.
This story reconciles the architecture guides and affected README descriptions.

Verification (2026-10-23): root `pnpm lint`, `pnpm typecheck`, `pnpm test`,
and `pnpm format` completed successfully. Tests: 531 backend, 352 frontend,
6 frontend migration checks, and 30 root configuration checks. The extraction
suite includes a regression that reports caption execution timestamps separately
from artifact ingestion timestamps and omits the retired review fields.
Prettier checks pass for all changed Markdown files; all 97 local link targets
in those files exist, and `git diff --check` and `pnpm check:workspace-tasks`
pass. Unrelated formatting produced by the root formatter was discarded.
No runtime/schema/client changes were needed. Browser E2E was not rerun for this
documentation and regression-test story; the earlier E2E failures are not a pass.
