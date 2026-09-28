# EPIC-21 — File-Centric Knowledge Processing

## Goal

Make each user's file library the canonical owner of extracted content, image
captions, chunks, embeddings, and processing status. A knowledge base becomes
an explicit ordered collection of a user's files. Adding one file to multiple
knowledge bases must not repeat extraction, captioning, chunking, or embedding
work.

**Status: Completed — all stories verified, user-confirmed, and merged to `main`.**

## Product decisions

- `UserFile` is the immutable user-owned source-file revision. Its SHA-256 is
  used only for per-user upload deduplication; no artifact, source file, or
  metadata is shared across users.
- Every supported file is processed in bounded background work immediately
  after upload. Text extraction, chunking, embeddings, and image captioning
  are canonical file artifacts, not knowledge-base artifacts.
- The platform has one active processing profile at a time: the global
  embedding model, extraction/chunking policy, and captioning configuration.
  Users cannot select per-file or per-knowledge-base models.
- A processing-profile change is an explicit operator action that queues a
  full reprocess of all eligible user files. Old artifacts remain readable only
  until their replacements are ready, then are retired as one controlled
  generation. The source file is never changed.
- Captions are canonical derived metadata of an image file revision. A user may
  view, edit, regenerate, or clear the caption in the file manager; that result
  applies in every knowledge base containing the file. There are no per-base
  captions. A later product feature may add separate per-base annotations.
- Generated text is searchable after successful processing. Users are
  responsible for redacting their uploads and any derived text they retain or
  edit. The product clearly discloses when an external caption provider receives
  an image and continues to avoid content in ordinary logs and audit details.
- A knowledge-base membership records only collection-specific data: base ID,
  file ID, ordering, timestamps, and optional future collection metadata. It
  does not own a file copy, caption, extraction cache, processing state, or
  vector.
- Retrieval remains authorization-first: resolve the active agent's assigned
  bases and their member file IDs before vector search, and enforce user and
  allowed-file filters in the vector-store query. Never perform a global search
  followed by application-side filtering.
- This is pre-release greenfield work. There are no customer or production-user
  records to preserve. The implementation may replace the existing
  knowledge-document schema and API rather than retaining a compatibility path.
  Fresh-install and clean-development-database behavior must be deterministic.

## Current-state replacement

Today `knowledge_documents` duplicates `UserFile` metadata and owns per-base
indexing/caption state; vector rows are keyed by `knowledge_base_id`. This epic
replaces it with `knowledge_base_files` memberships and file-keyed vector rows.
The file manager becomes the canonical place to observe and manage processing.
Knowledge-base pages become collection-management views.

## User stories

### US-21.1 — Establish canonical file knowledge artifacts

**As a user**, I want each file in my library to have one visible, reusable
knowledge-processing record so that I do not pay for duplicate processing when
I use the file in several knowledge bases.

**Dependencies:** None.

- [x] US-21.1-T1: Define a versioned `FileKnowledgeArtifact` contract and
      processing-profile identity covering extracted content, chunking, visual
      embedding, text embeddings, canonical caption state, safe failure state,
      and timestamps.
- [x] US-21.1-T2: Replace `KnowledgeDocumentModel` with a minimal
      `KnowledgeBaseFileModel` membership and move canonical artifact metadata
      to user-file-owned storage. Remove per-base file metadata, ingestion
      state, caption fields, and obsolete APIs rather than preserving a legacy
      compatibility layer.
- [x] US-21.1-T3: Change the vector-store record/protocol/schema to use
      `user_id`, `file_id`, artifact generation, and chunk provenance—not
      `knowledge_base_id`; support a mandatory filtered allowed-file search.
- [x] US-21.1-T4: Create clean-install database/vector initialization and
      deterministic development/test reset coverage. Update generated OpenAPI
      clients after the contract replacement.
- [x] US-21.1-T5: Add schema/service/vector tests for per-user isolation,
      membership uniqueness/order, file deletion cleanup, and the invariant
      that a file has at most one current artifact generation.

**Acceptance criteria**

- A user's file has one canonical processing/artifact identity regardless of
  how many knowledge bases reference it.
- A knowledge-base membership contains no duplicated derived content.
- No vector query can execute without both owner and allowed-file constraints.

### US-21.2 — Process user files automatically and reprocess globally

**As a user**, I want supported uploads to become searchable in the background
without first adding them to a knowledge base, and **as an operator**, I want a
single model-policy change to reprocess every eligible file consistently.

**Dependencies:** US-21.1.

- [x] US-21.2-T1: Trigger idempotent, bounded file-knowledge processing after
      upload and reuse the existing content-extraction cache when valid.
- [x] US-21.2-T2: Generate chunks and text/image embeddings once per file under
      the active processing profile; generate image captions under the global
      captioning configuration with existing provider/local safety boundaries.
- [x] US-21.2-T3: Implement file-level status, retry, cancellation, restart
      recovery, and safe errors. A partial/failed generation must never replace
      the last complete generation.
- [x] US-21.2-T4: Add an explicit admin reprocess operation for a changed
      processing profile. It snapshots the target generation, reports aggregate
      progress/failures, bounds concurrency, preserves search availability, and
      retires the previous generation only after successful replacement.
- [x] US-21.2-T5: Test duplicate upload reuse, concurrent processing, restart,
      provider/local caption behavior, profile-wide reprocessing, failure
      rollback, and source/derived-content deletion.

**Acceptance criteria**

- Uploading one eligible file queues one canonical processing job, whether or
  not the file is later added to zero, one, or many knowledge bases.
- An operator cannot create mixed user-selectable processing policies.
- A profile change has observable, bounded, recoverable whole-library progress.

### US-21.3 — Use file memberships for secure knowledge retrieval

**As a user**, I want knowledge bases to curate my processed files while agents
search only files in their assigned bases.

**Dependencies:** US-21.1, US-21.2.

- [x] US-21.3-T1: Replace document attachment APIs with ownership-safe add,
      list, reorder, and remove file-membership APIs. Adding an already-ready
      file must not enqueue processing; removing it must not delete the file or
      its artifacts.
- [x] US-21.3-T2: Update `search_knowledge` to resolve assigned bases to an
      allowed file-ID set and query the file-keyed vector store with mandatory
      user/file filters, bounded IDs/results/context, and stable provenance.
- [x] US-21.3-T3: Define no-ready-file, empty-membership, deleted-file,
      reprocessing-generation, and large-membership behavior. Benchmark and
      document the selected filtered-search strategy before raising collection
      limits.
- [x] US-21.3-T4: Make deleting a membership remove only that relationship;
      make deleting a file cancel its work, remove all memberships/artifacts/
      vectors/source bytes, and prevent late jobs from restoring them.
- [x] US-21.3-T5: Add API/runtime tests for zero/many memberships, one file in
      multiple bases, cross-user isolation, assigned-base boundaries, deletion
      races, and result provenance.

**Acceptance criteria**

- A file can appear in multiple owned knowledge bases without extra vectors.
- An agent retrieves only chunks whose files belong to one of its assigned
  bases, even when the same user has other indexed files.
- File and membership deletion have distinct, correct lifecycle effects.

### US-21.4 — Make the file manager the processing and caption workspace

**As a user**, I want to manage my files' processing, captions, and knowledge-
base memberships in one understandable interface.

**Dependencies:** US-21.1, US-21.2, US-21.3.

- [x] US-21.4-T1: Add generated-client file-manager views for knowledge status,
      current processing profile/generation, retry/reprocess availability, and
      safe failure explanations.
- [x] US-21.4-T2: Move caption view/edit/regenerate/clear actions to individual
      image files; label captions as canonical and show the external-provider
      disclosure whenever applicable.
- [x] US-21.4-T3: Change knowledge-base detail to attach existing library files,
      upload into the library then attach, list membership status, reorder, and
      remove membership without offering duplicate processing controls.
- [x] US-21.4-T4: Add accessible confirmation and impact copy for file deletion
      (all memberships and derived knowledge are removed) and clear copy for
      membership removal (the file remains in the library).
- [x] US-21.4-T5: Add frontend integration and Playwright coverage for upload
      processing, caption edits reflected across bases, multiple memberships,
      retry/failure, removal versus deletion, provider disclosure, and agent
      retrieval availability. Run all relevant quality gates and update the
      knowledge-retrieval architecture documentation.

**Acceptance criteria**

- The file manager is the single user-facing source for derived-file state and
  captions.
- Knowledge-base management communicates that it curates references, not copies.
- Users can distinguish external provider disclosure, file deletion, and
  membership removal before taking action.

## Execution

Order: **US-21.1 → US-21.2 → US-21.3 → US-21.4**. Work on one story at a time.
Create a feature branch only when starting a story. Regenerate the Hey API
client after every OpenAPI change; run focused and full relevant quality gates;
request user confirmation before merging each completed story.
