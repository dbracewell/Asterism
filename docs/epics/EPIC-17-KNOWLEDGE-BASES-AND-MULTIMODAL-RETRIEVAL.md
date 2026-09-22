# EPIC-17 — Knowledge Bases and Multimodal Retrieval

## Goal

Let a user create and manage private knowledge bases (named collections of
indexed documents), assign zero or more of them to each agent, and let an agent
search only its assigned knowledge during a chat. Retrieval must support both
text and image document content using a local, cross-platform embedding runtime.

**Status: US-17.1 through US-17.4 completed, user-confirmed, and merged; US-17.5 implementation complete and awaiting user confirmation.**

## Scope and decisions

- A knowledge base is owned by one user. It has a name, optional description,
  timestamps, and an explicit ordered set of documents.
- A document is an immutable uploaded-file revision plus ingestion/index status
  and metadata. Replacing file content creates a new document revision; it does
  not silently mutate embeddings already cited by a chat.
- Knowledge-base/document metadata, ownership, assignment, ingestion state, and
  audit records belong in the relational database. Vector chunks and embeddings
  belong behind a LanceDB vector-store adapter. Original files remain behind the
  existing file-store abstraction.
- An agent may have zero or more knowledge bases. Assignment is a user-owned
  explicit allowlist; deleting either side removes the relationship.
- `search_knowledge` is a built-in runtime tool, not an admin-configured tool.
  It is offered only when the active chat agent has at least one usable assigned
  knowledge base, is automatically authorized, and searches only those assigned
  bases. It must not be callable by an unassigned agent or be made available by
  a hallucinated tool name.
- Initial retrieval is user-private and text-query based. It retrieves chunks
  from textual documents and images using a shared multimodal vector space.
  Cross-user sharing, public bases, collaborative ACLs, web crawling, OCR
  beyond existing extraction support, and answer-grounded citation UX are out
  of scope unless introduced by a later story.
- All limits (files/base, bytes/file, chunks/document, concurrent ingestion,
  query `top_k`, and result/context bytes) must be configuration-backed and
  documented. Ingestion is bounded background work with restart/failure status;
  it is not an unbounded in-process task registry.

## Embedding research and provisional selection

The initial local model candidate is **`Xenova/clip-vit-base-patch32`**, using
its published `onnx/model_quantized.onnx` artifact with CPU `onnxruntime`.
It is a CLIP text-and-image model in one embedding space and exposes a
153,695,702-byte quantized ONNX artifact (about 147 MiB), well below the 400 MB
model-artifact budget. The original PyTorch artifact is 605,247,071 bytes and
is explicitly not the deployment artifact. ONNX Runtime has supported macOS and
Linux CPU distributions; CoreML acceleration is optional and must not be
required for correctness.

Sources checked 2026-09-22:

- [Xenova model files](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/main/onnx)
  — quantized ONNX artifact and processor/tokenizer files.
- [OpenAI CLIP model files](https://huggingface.co/openai/clip-vit-base-patch32/tree/main)
  — baseline unquantized weight size.
- [ONNX Runtime install matrix](https://onnxruntime.ai/docs/install/) — Linux and
  macOS CPU runtime support.

`nomic-ai/nomic-embed-vision-v1` was considered because its vision artifact is
371,806,672 bytes and its image embeddings share a space with Nomic text
embeddings. It is not selected for this size target: useful local text-to-image
retrieval also requires the companion text model (or its 138 MB quantized ONNX
artifact), making the required model bundle exceed 400 MB. It remains a quality
benchmark candidate if the size limit changes.

Before locking the runtime, benchmark the selected CLIP artifact on macOS
Apple Silicon, macOS Intel where available, and Linux x86_64 against a fixed
text/image relevance corpus. Verify compatible `onnxruntime`, `transformers` /
processor, Pillow, and Python 3.13 versions; cold download/cache behavior;
CPU RAM; embedding dimensions; and whether quantization meets the chosen
retrieval quality threshold. Pin model revision and SHA/size, require an
explicit local model cache directory, and fail ingestion/readiness clearly if
model initialization or integrity verification fails. Do not use
`trust_remote_code`.

## User stories

### US-17.1 — Establish storage, embedding, and lifecycle foundations (completed, user-confirmed, and merged)

**As an operator**, I want a replaceable and bounded knowledge indexing
foundation so that local multimodal retrieval is reliable on Linux and macOS.

**Dependencies:** None.

- [x] US-17.1-T1: Define vector-store and embedding-provider protocols, typed
      records, error taxonomy, and configuration. Provide a LanceDB adapter with
      per-user/base isolation strategy, schema/version metadata, filtered search,
      delete-by-document/base, and explicit close/lifespan behavior.
- [x] US-17.1-T2: Add the selected, pinned ONNX CLIP embedding provider behind
      the protocol. Implement normalized text and image embeddings in the same
      dimension, local artifact verification/cache location, no-network-after-
      initialization mode, and bounded concurrency.
- [x] US-17.1-T3: Benchmark the pinned artifact on supported macOS and Linux
      targets with a checked-in representative corpus. Record artifact size,
      cold/warm latency, peak memory, retrieval metrics, and pass/fail quality
      threshold; select a replacement only with an updated ADR.
- [x] US-17.1-T4: Create repeatable, data-preserving relational migrations for
      knowledge metadata and the vector schema/version migration/rebuild plan.
      Never rely on `create_all` for existing installations.
- [x] US-17.1-T5: Add adapter/provider tests using deterministic fake embeddings
      plus opt-in real-model smoke tests. Cover lifecycle, filtering, deletion,
      failure, concurrency bounds, and corrupt/missing model artifacts.

**Acceptance criteria**

- LanceDB and embedding details are hidden behind stable interfaces.
- The pinned local artifact bundle is below 400 MB and works on supported Linux
  and macOS CPU environments without remote code execution.
- Vector results cannot cross an owner/base filter, and storage/model failures
  surface actionable statuses without exposing document content.

### US-17.2 — Manage knowledge bases and documents

**As a user**, I want full CRUD for my knowledge bases and their documents so
that I control what can be searched.

**Dependencies:** US-17.1.

- [x] US-17.2-T1: Add ownership-safe create, list/paginate, get, update, and
      delete APIs for knowledge bases, including validation and stable conflict/
      not-found behavior.
- [x] US-17.2-T2: Add document add/list/get/update-metadata/delete operations.
      Reuse the file-store/upload authorization path, capture immutable file
      revision, media type, content hash, extraction/index version, and status.
- [x] US-17.2-T3: Implement bounded, idempotent document ingestion: extract
      supported text and images, chunk with stable IDs, generate embeddings,
      upsert LanceDB entries, and atomically expose a ready revision only after
      metadata/vector writes succeed. Define retry, cancellation, and partial
      failure/reindex behavior.
- [x] US-17.2-T4: Delete document vectors and files/references according to an
      explicit ownership/retention rule; deleting a base must remove its vectors,
      documents, assignments, and pending work safely.
- [x] US-17.2-T5: Add audit events for base/document CRUD and ingestion state
      transitions without retaining document content in logs.
- [x] US-17.2-T6: Add API/service/migration tests for ownership isolation,
      validation, concurrent mutation/ingestion, retry, deletion, and cleanup.
      Regenerate the Hey API client.

**Acceptance criteria**

- Users can fully manage only their own bases and documents.
- A ready document has searchable vectors for its current immutable revision;
  failed/pending revisions are never silently searched as ready.
- Deletion removes inaccessible vectors and prevents late ingestion from
  restoring them.

### US-17.3 — Assign knowledge bases to agents

**As a user**, I want to assign zero or more of my knowledge bases to an agent
so that each agent has an explicit retrieval boundary.

**Dependencies:** US-17.2.

- [x] US-17.3-T1: Add a relational agent-to-knowledge-base association with
      uniqueness, ownership checks, deterministic ordering, and cascade-safe
      deletion behavior.
- [x] US-17.3-T2: Add typed read/replace assignment APIs that reject foreign,
      deleted, or non-ready bases and preserve zero-assignment agents.
- [x] US-17.3-T3: Extend agent create/read/update views with assigned knowledge
      summaries without leaking another user's base/document metadata.
- [x] US-17.3-T4: Add service/router/migration tests for cross-user assignment,
      duplicate IDs, delete races, zero/many assignments, and legacy agents.
      Regenerate the Hey API client.

**Acceptance criteria**

- Knowledge access is explicit per agent, including an allowed empty set.
- An agent cannot be assigned a base outside its owner boundary.
- Deleting a base leaves no stale agent assignment or retrieval access.

### US-17.4 — Expose safe automatic knowledge search to the agent runtime

**As a user**, I want assigned knowledge to be searched automatically without
an approval prompt, while unassigned agents cannot access it.

**Dependencies:** US-17.3.

- [x] US-17.4-T1: Implement `search_knowledge` as a built-in runtime tool with
      validated query and bounded `top_k`/result bytes. Resolve active agent
      assignments once per execution and query only ready assigned bases using
      owner/base filters.
- [x] US-17.4-T2: Dynamically include the tool schema only for agents with one
      or more eligible assigned bases. Add a dedicated automatic-authorization
      path that cannot be overridden by chat runtime tool preferences and does
      not grant any other tool.
- [x] US-17.4-T3: Return structured excerpts with base/document/revision/chunk
      provenance suitable for later citations, stable score ordering, and safe
      no-results/failure messages. Do not return full files or unbounded chunks.
- [x] US-17.4-T4: Add execution/audit traces containing safe identifiers, result
      counts, duration, and model/index versions; never log query or document
      text by default.
- [x] US-17.4-T5: Test offered/not-offered behavior, automatic approval,
      zero/many assignments, strict user/base filtering, stale/deleted base
      handling, context limits, and injection-like document content.

**Acceptance criteria**

- `search_knowledge` is unavailable to an agent without an eligible assignment.
- When available it runs without an interactive approval prompt, but remains
  constrained to that agent's owned, assigned bases.
- Every result is traceable to a document revision and bounded for model context.

### US-17.5 — Build the knowledge-base and agent-assignment UI

**As a user**, I want an accessible interface to manage knowledge and attach it
to agents without manually calling APIs.

**Dependencies:** US-17.2, US-17.3.

- [x] US-17.5-T1: Add a knowledge-base list and create/edit/delete experience
      using generated API clients, with loading, empty, error, confirmation, and
      ownership-safe navigation states.
- [x] US-17.5-T2: Add base detail document management: upload/attach, list,
      status/progress, retry/reindex where supported, and destructive deletion
      confirmation. Clearly distinguish pending, ready, and failed documents.
- [x] US-17.5-T3: Add a multi-select knowledge-base assignment control to agent
      create/edit views. It supports zero selections and explains that assignment
      enables automatic `search_knowledge` for that agent.
- [x] US-17.5-T4: Add frontend unit/integration and Playwright coverage for CRUD,
      status, assignment, empty/error states, and agent-specific availability.
- [x] US-17.5-T5: Run quality gates, document local model storage/operations,
      LanceDB backup/rebuild procedure, ingestion limits, and retrieval security
      boundaries.

**Acceptance criteria**

- All knowledge and assignment flows use generated API clients.
- Users can see ingestion state and can safely manage zero or many assignments.
- UI and E2E tests prove an assigned agent exposes knowledge search while an
  unassigned one does not.

## Execution

Order: **US-17.1 → US-17.2 → US-17.3 → US-17.4 → US-17.5**. Work on one story at
a time. Create a feature branch only when starting a story. Regenerate the Hey
API client after every OpenAPI change and request user confirmation before
merging each completed story.
