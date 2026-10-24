# EPIC-36: Knowledge generation lifecycle

Status: complete; completion records reconciled at the user's request on
2026-10-24. Implementation already merged (`f41d01b`, merge `37ee995`); ancestry and
current focused regressions verified. See the [reconciliation record](../reviews/us-36.1-us-37.1-completion-reconciliation-2026-10-24.md)
and [completed checklist](../archive/todo-completed-2026-10-24.md).
Source: generation-mechanism review of the files domain
(2026-10-21) covering artifact generations, the "one current generation per
file" invariant, and the artifact reported to the user interface.

## Objective

Keep the artifact-generation mechanism bounded, portable, and consistent with
what retrieval actually serves.

The generation mechanism is load-bearing: it is what lets a processing-policy
change replace a file's derived knowledge without a search outage, and what
lets retrieval detect a re-extraction that lands mid-query. Three gaps made it
unbounded, dialect-dependent, and ambiguous to the UI:

1. Superseded generations were never pruned. Every processing-policy change
   mints a generation for the whole library and each generation owns its own
   chunk vectors, so the relational and vector stores grew without limit.
2. The "at most one current generation per file" invariant was enforced by a
   partial unique index declared for SQLite only. The same invariant is
   expressed for PostgreSQL, so it does not silently disappear on the next
   storage adapter.
3. File metadata and the knowledge-status endpoint reported the _newest_
   generation while retrieval serves the _current_ one, so the UI could show a
   file as "pending" while it was already searchable.

## Ownership and delivery

Implementation stays within the owning domain. The retention rule lives in the
knowledge domain (`knowledge/retention.py`). After EPIC-38, representative
artifact selection is published by `knowledge/artifacts.py` (`reported_artifacts`)
using `knowledge/queries.py`; `files/listing.py` consumes that published service.
Both behaviors are consumed by the existing service endpoints. Schema changes use fresh initialization; there are
no migrations, compatibility shims, or live-database resets.

## US-36.1: Bound, port, and align knowledge generations

As a platform operator, I want superseded knowledge generations to be pruned so
storage stays bounded, the current-generation invariant to hold on every
supported dialect, and the reported artifact to match the one retrieval
serves.

Estimate: 1–2 days. Dependencies: None.

Acceptance criteria:

A configurable retention window keeps the current generation plus a bounded
number of superseded generations per file; everything outside the window is
removed together with its vectors, and in-flight work is never pruned. The
one-current-generation invariant is declared for every dialect that supports
partial unique indexes. File metadata and the knowledge-status endpoint report
the current generation when one exists and the newest generation otherwise.
Regenerate and cancel keep acting on the newest generation, because they act
on processing work rather than on the serving generation.

Tasks:

- [x] Add `KNOWLEDGE_GENERATION_RETENTION` (0–10, default 1) with runtime
      validation.
- [x] Add `knowledge/retention.py` with a pure retention rule and the
      pruning routine; delete vectors before the rows that describe them, and
      keep a row when its vectors cannot be removed so the deletion retries.
- [x] Prune after a generation settles (promoted to ready, or terminally
      failed) in the ingestion path.
- [x] Declare the one-current-generation partial unique index for SQLite and
      PostgreSQL.
- [x] Report the current generation (falling back to the newest when no
      generation is current yet) from file metadata and the knowledge-status
      endpoint.
- [x] Cover the retention rule, pruning, dialect declaration and reporting
      with tests; run backend lint, type checks and the full test suite.
- [x] Document the retention window and the reported-artifact rule in the
      file-knowledge, retrieval and data-storage architecture guides.
