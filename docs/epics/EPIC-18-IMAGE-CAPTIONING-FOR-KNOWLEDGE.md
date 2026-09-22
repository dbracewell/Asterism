# EPIC-18 — Image Captioning for Knowledge

## Goal

Let users add useful, reviewable textual descriptions to image knowledge
revisions. An administrator chooses either an already configured
vision-capable provider model or an explicitly provisioned local SmolVLM2
runtime. Captions supplement—not replace—the existing CLIP image embedding,
so images remain searchable visually and their descriptions become useful
retrieval excerpts.

**Status: US-18.1 and US-18.2 complete; US-18.3 in progress.**

## Product decisions

- Captioning is disabled by default. An admin configures exactly one active
  captioning mode:
  - **Provider mode:** a model selected from discovered, vision-capable models
    of already configured providers.
  - **Local mode:** a pinned SmolVLM2 model downloaded on demand by the admin
    through the configuration UI.
- Provider mode sends an image only to the model/provider selected by the
  admin. It must use the existing provider capability, credentials, timeout,
  and audit boundaries; no automatic fallback to another provider is allowed.
- Local mode is opt-in and runs bounded background work on CPU. When an admin
  selects local mode the UI shows a **Download** button if the model is not yet
  present. Clicking it starts a background download with progress feedback.
  The model is pinned to a reviewed revision with integrity verification.
  Captioning is unavailable until the download completes and passes
  verification. The model never downloads during a caption request.
- A caption is derived metadata for one immutable image document revision.
  Store its source (`provider` or `local`), configured model/version, status,
  timestamps, safe failure reason, and bounded text. Preserve prior revisions;
  never silently overwrite an indexed revision.
- Generated text is draft content. Users can review, edit, regenerate, accept,
  or clear it. Only accepted/user-edited captions are added as text chunks.
  The original image CLIP vector remains independently indexed.
- Captions are bounded, must not contain the original image bytes, and are
  never written to default logs/audit detail. OCR is not promised: provider
  output may describe visible text, but no correctness guarantee is made.

## User stories

### US-18.1 — Establish captioning contracts and local runtime foundation (complete)

**As an operator**, I want a replaceable, bounded image-captioning foundation
so that provider and local caption generation are safe and observable.

- [x] US-18.1-T1: Define caption-provider protocols, typed caption/revision
      records, status/error taxonomy, configuration, and provider/local
      selection validation.
- [x] US-18.1-T2: Add a pinned local SmolVLM2 adapter with integrity checks,
      CPU-only execution, no remote code, bounded concurrency, and clear
      readiness failures.
- [x] US-18.1-T3: Benchmark local SmolVLM2 on supported macOS/Linux CPU targets
      for artifact size, cold/warm latency, peak RSS, caption quality, and
      concurrency; record the deployment threshold and hardware guidance.
- [x] US-18.1-T4: Add a bounded admin-initiated model download API that fetches
      the pinned SmolVLM2 revision to the local cache with progress reporting,
      integrity verification on completion, cancellation support, and safe
      failure/retry behavior. Captioning remains unavailable until the download
      succeeds.
- [x] US-18.1-T5: Add unit/smoke tests for provider selection, local artifact
      failure, lifecycle, bounds, and safe error handling.

**Acceptance criteria**

- Captioning is unavailable until an admin selects a valid mode.
- Local mode is unavailable until the admin downloads the model via the
  configuration UI.
- A local caption request cannot fetch remote code or model artifacts.
- Provider selection is limited to discovered vision-capable models.

### US-18.2 — Add admin configuration and revision-safe caption generation (complete)

**As an admin**, I want to configure captioning and as a user I want captions
attached safely to image revisions.

**Dependencies:** US-18.1.

- [x] US-18.2-T1: Add migration-backed caption configuration and image revision
      caption metadata/status with ownership-safe service APIs.
- [x] US-18.2-T2: Add an admin configuration API/UI that selects disabled,
      provider model, or local SmolVLM2 mode. When local mode is selected,
      display model download status; if not yet downloaded, show a Download
      button that triggers the download API with progress feedback and
      post-download verification. Display readiness and hardware guidance
      without exposing credentials.
- [x] US-18.2-T3: Implement bounded caption jobs with retry/cancel behavior,
      provider/local audit events, timeouts, and no image/caption text in
      default logs.
- [x] US-18.2-T4: On accept/edit/clear, atomically replace only the caption text
      vector chunk while retaining the revision's image vector and provenance.
- [x] US-18.2-T5: Add ownership, provider-capability, failure, cancellation,
      revision, and vector-cleanup tests; regenerate the Hey API client.

**Acceptance criteria**

- Generated captions cannot cross user/revision boundaries.
- A failed caption never replaces an accepted caption or image vector.
- Provider images are sent only to the admin-selected vision model.

### US-18.3 — Build reviewable caption UI and retrieval presentation

**As a user**, I want to generate and review image descriptions so that image
knowledge produces understandable search results.

**Dependencies:** US-18.2.

- [x] US-18.3-T1: Add image-document caption status, generate/retry/cancel,
      editable draft, accept, clear, and error states to knowledge-base detail.
- [x] US-18.3-T2: Clearly distinguish visual image matching from accepted caption
      text in bounded `search_knowledge` excerpts and provenance.
- [~] US-18.3-T3: Add frontend, backend, and Playwright tests for disabled,
      provider/local configuration, review/edit/accept, error, and retrieval
      flows.
- [x] US-18.3-T4: Document local provisioning, CPU memory/latency benchmark,
      provider privacy boundary, backup/rebuild, and operator recovery.

**Acceptance criteria**

- Users can accept zero or one caption per image revision and can always edit
  or remove it.
- A text query can return the accepted caption while visual similarity remains
  available for image queries.
- The UI makes caption source/status and provider privacy boundaries clear.

## Execution

Order: **US-18.1 → US-18.2 → US-18.3**. Work on one story at a time. Regenerate
the Hey API client after every OpenAPI change and request user confirmation
before merging each completed story.
